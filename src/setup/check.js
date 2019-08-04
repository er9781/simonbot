var fs = require('fs');
var constants = require('../constants');
var config = require('../config');
var git = require('../git/git');

exports.check = async () => {
    // check if secrets.json is set up.
    // if not, copy over example file and print message.
    if (!fs.existsSync(constants.CONSTANTS_FILE)) {
        fs.copyFileSync(constants.CONSTANTS_EXAMPLE_FILE, constants.CONSTANTS_FILE);
        throw new Error('Missing secrets.json. I copied it over for you, but go fill it out.');
    }

    // TODO check if all keys + types match in the config files.

    // TODO check github authentication.

    // check we have a git repo with remote set to the proper backend.
    const isRepo = await git.checkIsRepo();
    if (!git.checkIsRepo()) {
        throw new Error('clonedlocation in secrets is not a git repository');
    }
    const remotes = await git.getRemotes();
    const origin = remotes.filter(r => r.name === 'origin').first();
    if (!origin || !(origin.refs && origin.refs.fetch.includes(`${config.secrets.repoowner}/${config.secrets.repo}`))) {
        throw new Error(
            'clonedlocation must be a git repository with a remote called origin pointing to the configured repo'
        );
    }

    return true;
};
