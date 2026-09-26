let request = '';
for await (const chunk of process.stdin) request += chunk;
const version = JSON.parse(request).configurationVersion;
if (version === 'timeout') await new Promise(resolve => setTimeout(resolve, 200));
else if (version === 'oversize') process.stdout.write('x'.repeat(49_000));
else if (version === 'malformed') process.stdout.write('{not json}');
else process.stdout.write(JSON.stringify({ code: 'C3_REDEMPTION_REQUIRES_DEPLOYED_POSITION' }));
