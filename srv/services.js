const cds = require('@sap/cds')
const logger = require('cf-nodejs-logging-support');
class ProcessorService extends cds.ApplicationService {
  /** Registering custom event handlers */
  async init() {
     logger.info("Initialize processors endpoint!");

    this.before("UPDATE", "Incidents", (req) => this.onUpdate(req));
    this.before("CREATE", "Incidents", (req) => this.changeUrgencyDueToSubject(req.data));
    this.on('READ', 'Customers', (req) => this.onCustomerRead(req));
    this.on(['CREATE','UPDATE'], 'Incidents', (req, next) => this.onCustomerCache(req, next));
    this.S4bupa = await cds.connect.to('OP_API_BUSINESS_PARTNER_SRV');
    this.remoteService = await cds.connect.to('RemoteService');
    
    // Initialize feedback service connection (optional - for direct CAP service calls)
    try {
      this.feedbackService = await cds.connect.to('FeedbackService');
      logger.info("Connected to FeedbackService");
    } catch (error) {
      logger.warn("Could not connect to FeedbackService, will use HTTP fallback:", error.message);
    }
    
    return super.init();
  }

  async onCustomerCache(req, next) {
  const { Customers } = this.entities;
  const newCustomerId = req.data.customer_ID;
  const result = await next();
  const { BusinessPartner } = this.remoteService.entities;
  if (newCustomerId && newCustomerId !== "") {
    console.log('>> CREATE or UPDATE customer!');

    // Expands are required as the runtime does not support path expressions for remote services
    const customer = await this.S4bupa.run(SELECT.one(BusinessPartner, bp => {
      bp('*');
        bp.addresses(address => {
          address('email', 'phoneNumber');
            address.email(emails => {
              emails('email')
            });
            address.phoneNumber(phoneNumber => {
              phoneNumber('phone')
            })
        })
    }).where({ ID: newCustomerId }));

    if(customer) {
      customer.email = customer.addresses[0]?.email[0]?.email;
      customer.phone = customer.addresses[0]?.phoneNumber[0]?.phone;
      delete customer.addresses;
      delete customer.name;
      await UPSERT.into(Customers).entries(customer);
    }
  }
  return result;
}
    
async onCustomerRead(req) {
      console.log('>> delegating to S4 service...', req.query);
      let { limit, one } = req.query.SELECT
      if(!limit) limit = { rows: { val: 55 }, offset: { val: 0 } } //default limit to 55 rows

      const { BusinessPartner } = this.remoteService.entities;
      const query = SELECT.from(BusinessPartner, bp => {
        bp('*');
        bp.addresses(address => {
          address('email');
          address.email(emails => {
            emails('email');
          });
        });
      }).limit(limit)

      if(one){
        // support for single entity read
        query.where({ ID: req.data.ID });
      }
      // Expands are required as the runtime does not support path expressions for remote services
      let result = await this.S4bupa.run(query);

      result = result.map((bp) => ({
        ID: bp.ID,
        name: bp.name,
        email: (bp.addresses[0]?.email[0]?.email || ''),
        firstName: bp.firstName,
        lastName: bp.lastName,
      }));

      // Explicitly set $count so the values show up in the value help in the UI
      result.$count = 1000;
      console.log("after result", result);
      return result;
    }   
  changeUrgencyDueToSubject(data) {
    if (data) {
      const incidents = Array.isArray(data) ? data : [data];
      incidents.forEach((incident) => {
        if (incident.title?.toLowerCase().includes("urgent")) {
          incident.urgency = { code: "H", descr: "High" };
        }
      });
    }
  }

  /** Custom Validation */
  async onUpdate (req) {
   logger.info("Request id is: ", req.data.ID);
    const { status_code } = await SELECT.one(req.subject, i => i.status_code).where({ ID: req.data.ID })
    logger.info("Status code is: ", status_code);
    
    // Check if incident is being closed
    if (req.data.status_code === 'C' && status_code !== 'C') {
      logger.info("Incident is being closed, triggering feedback service...");
      await this.triggerFeedbackService(req.data.ID);
    }
    
    if (status_code === 'C'){
      try {
        throw new Error("Incident state doesn't allow further modifications.");
      } catch (e) {
        logger.error("Incident state doesn't allow further modifications.", e);
        logger.info("Logging code: Entering mutex state, only one change is allowed at a time.");
        logger.info("Incident state is being update from In process to Closed, by external process (Inbound API)");
      }
      return req.reject(`Incident state doesn't allow further modifications.`)
    }
  }

  /** Trigger Feedback Service when incident is closed */
  async triggerFeedbackService(incidentID) {
    try {
      const { Incidents, Customers } = this.entities;
      
      // Get the incident details
      const incident = await SELECT.one.from(Incidents, i => {
        i('*');
        i.customer(c => c('*'));
      }).where({ ID: incidentID });
      
      if (!incident) {
        logger.error(`Incident with ID ${incidentID} not found`);
        return;
      }
      
      // Calculate processing time
      const createdAt = new Date(incident.createdAt);
      const now = new Date();
      const processingTimeHours = Math.round((now - createdAt) / (1000 * 60 * 60));
      
      // Prepare data for feedback service
      const feedbackData = {
        originalIncidentID: incidentID,
        title: incident.title || 'Unknown Title',
        customer: incident.customer ? incident.customer.name || `${incident.customer.firstName} ${incident.customer.lastName}`.trim() : 'Unknown Customer',
        customerEmail: incident.customer ? incident.customer.email : '',
        urgency: incident.urgency_code || 'M',
        category: 'General', // Default category, can be enhanced
        processingTime: processingTimeHours
      };
      
      // Use CAP's destination service approach with JWT forwarding
      await this.callFeedbackServiceViaDestination(feedbackData);
      
    } catch (error) {
      logger.error(`Error triggering feedback service for incident ${incidentID}:`, error);
    }
  }

  /** 
   * Call feedback service using SAP Cloud SDK with destination and JWT forwarding
   * This is the enterprise-grade approach for service-to-service communication
   */
  async callFeedbackServiceViaDestination(feedbackData) {
    try {
      // Import SAP Cloud SDK modules
      const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
      const { getDestination } = require('@sap-cloud-sdk/connectivity');
      
      // Get the current request context to forward JWT token
      const req = cds.context?.req;
      if (!req) {
        logger.warn('No request context available for JWT forwarding');
      }
      
      // Method 1: Using destination service (Recommended for production)
      try {
        const destination = await getDestination({
          destinationName: 'feedback-service-dest',
          jwt: req?.headers?.authorization?.replace('Bearer ', '') // Forward JWT token
        });
        
        const response = await executeHttpRequest(
          destination,
          {
            method: 'POST',
            url: '/odata/v4/feedback/createClosedIncident',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            data: feedbackData
          }
        );
        
        logger.info(`Successfully created closed incident entry via destination service`);
        return response.data;
        
      } catch (destError) {
        logger.warn(`Destination service call failed: ${destError.message}`);
        
        // Method 2: Fallback to direct service binding (for local development)
        return await this.callFeedbackServiceDirectly(feedbackData, req);
      }
      
    } catch (error) {
      logger.error('Error calling feedback service:', error);
      throw error;
    }
  }
  
  /**
   * Fallback method for local development or when destination service is not available
   */
  async callFeedbackServiceDirectly(feedbackData, req) {
    try {
      // Try to connect to feedback service using CAP service binding
      const feedbackService = await cds.connect.to('FeedbackService');
      
      if (feedbackService) {
        // Use CAP service-to-service communication
        const result = await feedbackService.send('createClosedIncident', feedbackData);
        logger.info('Successfully called feedback service via CAP binding');
        return result;
      } else {
        // Final fallback to HTTP call with JWT forwarding
        const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
        
        const feedbackServiceUrl = process.env.FEEDBACK_SERVICE_URL || 'http://localhost:4006';
        
        const headers = {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        };
        
        // Forward JWT token if available
        if (req?.headers?.authorization) {
          headers['Authorization'] = req.headers.authorization;
        }
        
        const response = await executeHttpRequest(
          { url: feedbackServiceUrl },
          {
            method: 'POST',
            url: '/odata/v4/feedback/createClosedIncident',
            headers,
            data: feedbackData
          }
        );
        
        logger.info('Successfully called feedback service via HTTP fallback');
        return response.data;
      }
      
    } catch (error) {
      logger.error('Direct service call failed:', error);
      throw error;
    }
  }

}
module.exports = { ProcessorService }
