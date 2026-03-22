  // Terminal animation — KDE Konsole style
  const out    = document.getElementById('terminal-output');
  const cursor = document.getElementById('term-cursor');

  const USER = 'olivier';
  const HOST = 'srv-01';
  const PATH = '~';

  const commands = [
    {
      cmd: 'uname -a',
      output: [
        { text: 'Linux srv-01 6.1.0-28-amd64 #1 SMP Debian 13.2 x86_64 GNU/Linux', color: '#d4d4d4' }
      ]
    },
    {
      cmd: 'ip addr show eth0 | grep inet',
      output: [
        { text: '    inet 192.168.1.42/24 brd 192.168.1.255 scope global eth0', color: '#d4d4d4' },
        { text: '    inet6 fe80::21a:2bff:fe3c:4d5e/64 scope link',             color: '#d4d4d4' }
      ]
    },
    {
      cmd: 'ping -c 3 8.8.8.8',
      output: [
        { text: 'PING 8.8.8.8 56(84) bytes of data.',                                        color: '#d4d4d4' },
        { text: '64 bytes from 8.8.8.8: icmp_seq=1 ttl=117 time=12.3 ms',                    color: '#a6e3a1' },
        { text: '64 bytes from 8.8.8.8: icmp_seq=2 ttl=117 time=11.8 ms',                    color: '#a6e3a1' },
        { text: '64 bytes from 8.8.8.8: icmp_seq=3 ttl=117 time=12.1 ms',                    color: '#a6e3a1' },
        { text: '3 packets transmitted, 3 received, 0% packet loss, time 2003ms',             color: '#a6e3a1' }
      ]
    },
    {
      cmd: 'systemctl status nginx --no-pager',
      output: [
        { text: '\u25cf nginx.service - A high performance web server',              color: '#d4d4d4' },
        { text: '     Loaded: loaded (/lib/systemd/system/nginx.service; enabled)',  color: '#d4d4d4' },
        { text: '     Active: active (running) since 2026-03-06 09:14 CET; 4h ago', color: '#a6e3a1' }
      ]
    },
    {
      cmd: 'df -h | grep -E "^/dev"',
      output: [
        { text: '/dev/sda1   50G   18G   32G  37% /', color: '#d4d4d4' },
        { text: '/dev/sda2  200G  142G   58G  72% /data', color: '#f38ba8' }
      ]
    },
    {
      cmd: 'docker ps --format "table {{.Names}}\\t{{.Status}}"',
      output: [
        { text: 'NAMES              STATUS',     color: '#6c6c6c' },
        { text: 'nginx-proxy        Up 4 hours', color: '#a6e3a1' },
        { text: 'portfolio-app      Up 4 hours', color: '#a6e3a1' },
        { text: 'mysql-db           Up 4 hours', color: '#a6e3a1' }
      ]
    }
  ];

  let idx = 0;
  let currentBlock = null;

  function scrollDown() {
    const body = out.closest('.term-body');
    if (body) body.scrollTop = body.scrollHeight;
  }

  function buildPrompt() {
    const s = document.createElement('span');
    s.innerHTML =
      `<span style="color:#a6e3a1;font-weight:700">${USER}@${HOST}</span>` +
      `<span style="color:#d4d4d4">:${PATH}</span>` +
      `<span style="color:#d4d4d4">$ </span>`;
    return s;
  }

  function typeCommand(cmd, done) {
    currentBlock = document.createElement('div');
    out.appendChild(currentBlock);

    const line = document.createElement('div');
    line.appendChild(buildPrompt());
    const cmdSpan = document.createElement('span');
    cmdSpan.style.color = '#d4d4d4';
    line.appendChild(cmdSpan);
    line.appendChild(cursor);
    currentBlock.appendChild(line);

    let i = 0;
    const t = setInterval(() => {
      if (i < cmd.length) {
        cmdSpan.textContent += cmd[i++];
        scrollDown();
      } else {
        clearInterval(t);
        setTimeout(done, 420);
      }
    }, 46);
  }

  function showOutput(lines, done) {
    let i = 0;
    const next = () => {
      if (i >= lines.length) {
        currentBlock.appendChild(cursor);
        setTimeout(done, 1000);
        return;
      }
      const row = document.createElement('div');
      row.style.color  = lines[i].color;
      row.textContent  = lines[i].text;
      currentBlock.appendChild(row);
      currentBlock.appendChild(cursor);
      scrollDown();
      i++;
      setTimeout(next, 115);
    };
    next();
  }

function typeClearAndReset(done) {
    const line = document.createElement('div');
    line.appendChild(buildPrompt());
    const cmdSpan = document.createElement('span');
    cmdSpan.style.color = '#d4d4d4';
    line.appendChild(cmdSpan);
    line.appendChild(cursor);
    out.appendChild(line);
    scrollDown();

    const cmd = 'clear';
    let i = 0;
    const t = setInterval(() => {
      if (i < cmd.length) {
        cmdSpan.textContent += cmd[i++];
        scrollDown();
      } else {
        clearInterval(t);
        setTimeout(() => {
          out.innerHTML = '';
          out.appendChild(cursor);
          currentBlock = null;
          done();
        }, 400);
      }
    }, 60);
  }

  function run() {
    if (idx >= commands.length) {
      setTimeout(() => {
        typeClearAndReset(() => {
          idx = 0;
          run();
        });
      }, 10000);
      return;
    }
    const { cmd, output } = commands[idx++];
    typeCommand(cmd, () => showOutput(output, run));
  }

  setTimeout(run, 600);
