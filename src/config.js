var fs = require('fs');
var constants = require('./constants');

const secrets = JSON.parse(fs.readFileSync(constants.CONSTANTS_FILE));

exports.secrets = secrets;

exports.gitrepourl = `https://github.com/${secrets.repoowner}/${secrets.repo}`;
