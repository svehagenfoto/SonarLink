const { execFile } = require('child_process');

const PROCESS_NAMES = [
  'Subnautica2-Win64-Shipping.exe',
  'Subnautica2.exe',
];

function listProcesses() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true }, (err, stdout) => {
      if (err) {
        resolve([]);
        return;
      }
      const names = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const match = line.match(/^"([^"]+)"/);
          return match ? match[1] : line.split(',')[0].replace(/"/g, '');
        });
      resolve(names);
    });
  });
}

async function isSubnauticaRunning() {
  const running = await listProcesses();
  const lower = running.map((n) => n.toLowerCase());
  return PROCESS_NAMES.some((name) => lower.includes(name.toLowerCase()));
}

function watchSubnautica(onChange, intervalMs = 1500) {
  let last = null;

  const tick = async () => {
    const running = await isSubnauticaRunning();
    if (running !== last) {
      last = running;
      onChange(running);
    }
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}

module.exports = {
  PROCESS_NAMES,
  isSubnauticaRunning,
  watchSubnautica,
};
