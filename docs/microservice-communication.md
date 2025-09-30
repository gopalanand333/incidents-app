# Enterprise Microservice Communication with CAP

This document explains how to implement enterprise-grade service-to-service communication using SAP CAP concepts with destination service and JWT token forwarding.

## Architecture Overview

```
[Incidents Service] --> [Destination Service] --> [Feedback Service]
        |                       |                        |
    JWT Token  -----> Forward JWT Token -----> Validate JWT Token
```

## Implementation Approaches

### 1. **Destination Service with JWT Forwarding (Recommended for Production)**

```javascript
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const { getDestination } = require('@sap-cloud-sdk/connectivity');

// Get destination with JWT forwarding
const destination = await getDestination({
  destinationName: 'feedback-service-dest',
  jwt: req?.headers?.authorization?.replace('Bearer ', '')
});

// Execute request with automatic JWT forwarding
const response = await executeHttpRequest(destination, {
  method: 'POST',
  url: '/odata/v4/feedback/createClosedIncident',
  data: feedbackData
});
```

**Benefits:**
- ✅ Automatic JWT token forwarding
- ✅ Centralized destination management
- ✅ Built-in resilience patterns
- ✅ Production-ready security
- ✅ Configuration via BTP Cockpit

### 2. **CAP Service Binding (Alternative)**

```javascript
// Configure in package.json
"FeedbackService": {
  "kind": "odata-v4",
  "[production]": {
    "credentials": {
      "destination": "feedback-service-dest"
    }
  }
}

// Use in code
const feedbackService = await cds.connect.to('FeedbackService');
const result = await feedbackService.send('createClosedIncident', data);
```

**Benefits:**
- ✅ Native CAP integration
- ✅ Automatic service discovery
- ✅ Type-safe operations
- ✅ Built-in error handling

### 3. **Direct HTTP with Manual JWT Forwarding (Fallback)**

```javascript
const headers = {
  'Content-Type': 'application/json',
  'Authorization': req.headers.authorization // Forward JWT
};

const response = await executeHttpRequest(
  { url: serviceUrl },
  { method: 'POST', headers, data }
);
```

## Configuration Setup

### 1. **Destination Configuration**

Create destination in BTP Cockpit or via JSON:

```json
{
  "Name": "feedback-service-dest",
  "Type": "HTTP",
  "URL": "https://feedback-service.cfapps.eu10.hana.ondemand.com",
  "Authentication": "OAuth2JWTBearer",
  "Properties": [
    {
      "Name": "HTML5.ForwardAuthToken",
      "Value": "true"
    }
  ]
}
```

### 2. **CAP Service Configuration**

In `package.json`:

```json
{
  "cds": {
    "requires": {
      "FeedbackService": {
        "kind": "odata-v4",
        "[development]": {
          "credentials": {
            "url": "http://localhost:4006/odata/v4/feedback"
          }
        },
        "[production]": {
          "credentials": {
            "destination": "feedback-service-dest",
            "path": "/odata/v4/feedback"
          }
        }
      }
    }
  }
}
```

### 3. **Environment Variables**

```bash
# Development
export FEEDBACK_SERVICE_URL=http://localhost:4006

# Production (handled by destination service)
# VCAP_SERVICES will contain destination binding
```

## Security Considerations

### JWT Token Forwarding

1. **Automatic Forwarding**: Destination service handles JWT propagation
2. **Manual Forwarding**: Extract from request headers when needed
3. **Token Validation**: Receiving service validates JWT automatically

### Authentication Flow

```
User Request --> Incidents Service (JWT) --> Destination Service (Forward JWT) --> Feedback Service (Validate JWT)
```

## Error Handling Strategy

The implementation uses a **cascading fallback** approach:

1. **Primary**: Destination service with JWT forwarding
2. **Secondary**: CAP service binding
3. **Fallback**: Direct HTTP with manual JWT forwarding

```javascript
try {
  // Try destination service
  return await callViaDestination(data);
} catch (destError) {
  try {
    // Try CAP service binding
    return await callViaCAP(data);
  } catch (capError) {
    // Final fallback to HTTP
    return await callViaHTTP(data);
  }
}
```

## Development vs Production

| Aspect | Development | Production |
|--------|-------------|------------|
| **Service Discovery** | Direct URL | Destination Service |
| **Authentication** | Basic/None | OAuth2 JWT Bearer |
| **JWT Forwarding** | Manual | Automatic |
| **Configuration** | Environment Variables | BTP Destinations |
| **Resilience** | Basic | Advanced (Circuit Breaker, Retry) |

## Implementation Checklist

- [ ] Configure destination in BTP Cockpit
- [ ] Add CAP service binding to package.json
- [ ] Implement cascading fallback logic
- [ ] Add proper error handling and logging
- [ ] Test JWT token forwarding
- [ ] Verify service authentication
- [ ] Set up monitoring and alerting

## Best Practices

1. **Always forward JWT tokens** for proper authentication
2. **Use destination service** for production deployments
3. **Implement fallback mechanisms** for resilience
4. **Log service calls** for debugging and monitoring
5. **Handle errors gracefully** with meaningful messages
6. **Test in different environments** (dev, staging, prod)

## Troubleshooting

### Common Issues

1. **401 Unauthorized**: Check JWT token forwarding
2. **404 Not Found**: Verify destination URL and path
3. **500 Internal Error**: Check service availability and logs
4. **Timeout**: Configure appropriate timeout values

### Debug Commands

```bash
# Check destinations
cf destinations

# Check service bindings
cf env your-app-name

# Check logs
cf logs your-app-name --recent
```