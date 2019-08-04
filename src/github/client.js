var config = require('../config');
var https = require('https');

const v4baseurl = 'https://api.github.com/graphql';

// data expected to be an object. will be stringified
const request = ({ method = 'POST', data, headers = {}, url = v4baseurl } = {}) => {
    console.assert(['GET', 'POST'].includes(method));
    console.assert(config.secrets.githubToken, 'Must have a github token.');

    body = method === 'POST' && typeof data !== 'undefined' && JSON.stringify(data);
    const options = {
        method,
        headers: {
            Authorization: `token ${config.secrets.githubToken}`,
            // if github breaks on us, rip. we'll deal with it then.
            Accept: 'application/vnd.github.antiope-preview+json',
            // vnd.github.merge-info-preview
            // vnd.github.antiope-preview
            'Content-Type': 'application/json',
            'User-Agent': 'bot',
        },
        ...(body ? { 'Content-Length': body.length } : {}),
        ...headers,
    };

    if (method === 'GET' && data) {
        // TODO append query string with data on to the url.
        // url = some other stuff
    }

    return new Promise((resolve, reject) => {
        const req = https.request(url, options, resp => {
            // fail on 4xx or 5xx codes. maybe consider more granular errors. Could retry on 5xx but not on 4xx for instance.
            if (resp.statusCode >= 400) {
                reject({
                    status: resp.statusCode,
                    message: resp.statusMessage,
                });
            }

            // TODO do we want automatic retries?

            let body = '';
            resp.on('data', data => {
                body += data;
            });

            resp.on('end', () => {
                let out = JSON.parse(body);
                if (out.errors) {
                    reject({ error: out.errors });
                }

                // success yay. let's return status + body.
                resolve({ status: resp.statusCode, body: out });
            });
        });

        req.on('error', err => {
            reject({ error: 'request failed' });
        });

        if (method === 'POST' && body) {
            req.write(body);
        }
        req.end();
    });
};

const v3baseurl = 'https://api.github.com';
// default to get, allow overrides
const v3request = async ({ uri, headers, ...rest }) => {
    return await request({
        url: v3baseurl + uri,
        method: 'GET',
        headers: {
            // required to get v3 of the api. hmmm.
            Accept: 'application/vnd.github.v3+json',
            ...headers,
        },
        ...rest,
    });
};

const query = query => request({ data: { query } });

exports.query = query;
exports.v3request = v3request;
