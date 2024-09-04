// scripts/showNetworkUrls.js
const os = require('os');
const chalk = require('chalk');

function getNetworkUrls(port) {
  const interfaces = os.networkInterfaces();
  const urls = [];

  Object.keys(interfaces).forEach((interfaceName) => {
    interfaces[interfaceName].forEach((iface) => {
      if (iface.family === 'IPv4' && !iface.internal) {
        urls.push(`http://${iface.address}:${port}`);
      }
    });
  });

  return urls;
}

function showNetworkUrls(port) {
  const urls = getNetworkUrls(port);
  console.log(chalk.green('\nAvailable on your network:'));
  urls.forEach((url) => {
    console.log(chalk.cyan(`  ${url}`));
  });
}

module.exports = showNetworkUrls;