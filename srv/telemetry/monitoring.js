const { metrics } = require("@opentelemetry/api");
const cds = require("@sap/cds");

module.exports = class Monitoring {
  static mockMetric;
  static init() {
    this.mockMetric = metrics.getMeterProvider()
      .getMeter("customerMetrics")
      .createCounter("mock_metric");
  }
  static addMockMetricCount() {
    const config = {};
    const tenant = cds.context?.tenant;
    if (tenant) {
      config["sap.tenancy.tenant_id"] = tenant;
    }
    this.mockMetric.add(1, config);
  }
};
