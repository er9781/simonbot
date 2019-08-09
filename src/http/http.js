var https = require('https');
var querystring = require('querystring');

exports.request = async ({ method = 'POST', body, headers = {}, url, query } = {}) => {
    console.assert(['GET', 'POST', 'PUT'].includes(method));
    console.assert(url, 'must have a url');

    const qs = query && querystring.stringify(query);
    const fullUrl = url + (qs ? `?${qs}` : '');

    const options = {
        // 2 min probably sufficient
        timeout: 120000,
        method,
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'bot',
            // TODO this is probably wrong for utf-16 strings. should fix it.
            // https://stackoverflow.com/questions/5515869/string-length-in-bytes-in-javascript
            // ...(body ? { 'Content-Length': body.length.toString() } : {}),
            ...headers,
        },
    };

    return new Promise((resolve, reject) => {
        const req = https.request(fullUrl, options, resp => {
            // fail on 4xx or 5xx codes. maybe consider more granular errors. Could retry on 5xx but not on 4xx for instance.
            if (resp.statusCode >= 400) {
                reject({
                    status: resp.statusCode,
                    message: resp.statusMessage,
                });
            }

            // TODO do we want automatic retries?

            let respBody = '';
            resp.on('data', data => {
                respBody += data;
            });

            resp.on('end', () => {
                // success yay. let's return status + body.
                resolve({ status: resp.statusCode, body: respBody });
            });
        });

        req.on('error', err => {
            reject({ error: 'request failed' });
        });

        if (method !== 'GET' && body) {
            req.write(body);
        }
        req.end();
    });
};
