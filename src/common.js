var _ = require('lodash');

exports.prn = x => console.log(x) || x;

// returns undefined if passed an empty array or falsy value. Otherwise returns the array
exports.notEmpty = (x => x && x.length && x.length > 0 && x) || undefined;

// concatenates arrays. falsy inputs are ignored.
exports.concat = (...args) => _.concat(...args.map(e => e || []));
