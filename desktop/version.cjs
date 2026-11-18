/** Single source of truth for the desktop app version. */
const pkg = require("../package.json");
module.exports = { VERSION: pkg.version, PRODUCT: "CLIPX AI" };
