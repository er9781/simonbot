var fs = require('fs');
var constants = require('../constants');
var config = require('../config');
var git = require('../git/git');
var github = require('../github/github');
var buildkite = require('../buildkite/buildkite');
var _ = require('lodash');

exports.getGitRemote = env =>
    `https://${env.githubUsername}:${config.secrets.githubToken}@github.com/${config.secrets.repoowner}/${
        config.secrets.repo
    }`;

const hasSameKeys = (obj1, obj2) => {
    return _.isEqual(...[obj1, obj2].map(o => new Set(Object.keys(o))));
};

exports.setup = async () => {
    // check if secrets.json is set up.
    // if not, copy over example file and print message.
    if (!fs.existsSync(constants.CONSTANTS_FILE)) {
        fs.copyFileSync(constants.CONSTANTS_EXAMPLE_FILE, constants.CONSTANTS_FILE);
        throw new Error('Missing secrets.json. I copied it over for you, but go fill it out.');
    }

    // check if all secrets are there.
    const exampleSecrets = JSON.parse(fs.readFileSync(constants.CONSTANTS_EXAMPLE_FILE));
    if (!hasSameKeys(config.secrets, exampleSecrets)) {
        // TODO show which keys are missing.
        throw new Error('keys must match between the example secrets and your secrets file.');
    }

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

    const env = {};
    try {
        env.githubUsername = await github.getUsername();
    } catch (err) {
        throw new Error('failed to access github api. riperino.');
    }

    try {
        const isValid = await buildkite.checkAuth();
        if (!isValid) {
            console.warn('invalid buildkite token, or missing scopes. must have all of', ...buildkite.requiredScopes);
        } else {
            env.buildkiteIsValid = true;
        }
    } catch (err) {
        console.warn('failed to access buildkite api. Will not use any buildkite dependent features');
    }

    // TODO read from somewhere else?
    env.privateKey = fs.readFileSync('privatekey.pem', { encoding: 'utf-8' });

    return env;
};
