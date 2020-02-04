var fs = require('fs');
var constants = require('./constants');

const secrets = JSON.parse(fs.readFileSync(constants.CONSTANTS_FILE));

exports.secrets = secrets;

exports.gitrepourl = `https://github.com/${secrets.repoowner}/${secrets.repo}`;

exports.extraUsers = (() => {
    const contents = fs.readFileSync(constants.EXTRA_USERS_FILE, { encoding: 'utf8' });
    // remove empty lines
    // TODO consider validating the list?
    return contents.split('\n').filter(line => line.length);
})();

exports.startingMainActionsCounter = (() => {
    if (fs.existsSync('data.json')) {
        const contents = fs.readFileSync('data.json', 'utf-8');
        const json = (contents.trim() && JSON.parse(contents.trim())) || {};
        return json.mainActionsCounter || 0;
    } else {
        return 0;
    }
})();

exports.writeMainActionsCounter = mainActionsCounter => {
    fs.writeFileSync('data.json', JSON.stringify({ mainActionsCounter }));
};
