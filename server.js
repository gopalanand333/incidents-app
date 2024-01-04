// Define allowed access origins for CORS checks
// In our example we allow all origins. For productive use specific origins shall be allowed only.

const cds = require("@sap/cds");
const { OtelInst } = require("./srv/telemetry");

OtelInst.init();


cds.on("listening", () => {
  // add more middleware ...
});

module.exports = cds.server; // delegate to default server.js