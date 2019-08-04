var fs = require('fs');
var constants = require('../constants');

// returns a boolean to indicate if checks are ok.
exports.check = () => {
    // TODO check if secrets.json is set up.
    // if not, copy over example file and print message.
    if (!fs.existsSync(constants.CONSTANTS_FILE)) {
        fs.copyFileSync(constants.CONSTANTS_EXAMPLE_FILE, constants.CONSTANTS_FILE);
        return false;
    }

    // TODO check if all keys + types match in the config files.

    // TODO check that git repo is cloned. If not, suggest running setup. run it for them?

    return true;
};
