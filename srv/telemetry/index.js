const cds = require("@sap/cds");
const path = require("path");
const Monitoring = require("./monitoring");
const options = require("./credKey/options.json");

class OtelInst {
  static init() {

    Monitoring.init();
  }
}

module.exports = { OtelInst, Monitoring };