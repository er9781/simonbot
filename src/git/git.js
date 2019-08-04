var config = require('../config');
var git = require('simple-git/promise')(config.secrets.clonedlocation);

exports.status = async () => git.status();
exports.checkIsRepo = async () => git.checkIsRepo();
exports.getRemotes = async () => git.getRemotes(true);

// fetches a single branch
exports.fetch = async branch => git.fetch('origin', branch);

exports.rebase = async branch => git.rebase([branch]);
exports.checkout = async branch => git.checkout(branch);
exports.clean = async () => git.clean('fd');

exports.push = async (...args) => git.push(...args);

exports.addAll = async () => git.add('.');
exports.commit = async (message, options = {}) =>
    git.commit(message, { '--author': `simonbot <${config.secrets.commitEmail}>`, ...options });

exports.raw = async cmd => {
    console.assert(cmd.length > 0 && !cmd[0].trim().startsWith('git'), 'git gets auto included for you.');
    return git.raw(cmd);
};
