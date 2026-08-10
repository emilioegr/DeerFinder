import bcrypt from 'bcryptjs';

const CTRL_C = String.fromCharCode(3);
const CTRL_D = String.fromCharCode(4);
const BACKSPACE = String.fromCharCode(127);

// Prompts with the terminal's input masked (shows * per keystroke) rather
// than echoing the password in plain text to the terminal/scrollback.
function promptPassword(query) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    stdout.write(query);

    let password = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const onData = (char) => {
      if (char === '\n' || char === '\r' || char === CTRL_D) {
        stdin.setRawMode(false);
        stdin.removeListener('data', onData);
        stdout.write('\n');
        resolve(password);
      } else if (char === CTRL_C) {
        stdout.write('\n');
        process.exit(1);
      } else if (char === BACKSPACE) {
        if (password.length > 0) {
          password = password.slice(0, -1);
          stdout.write('\b \b');
        }
      } else {
        password += char;
        stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const password = await promptPassword('Admin password: ');
  if (!password) {
    console.error('Password cannot be empty.');
    process.exit(1);
  }

  const confirm = await promptPassword('Confirm password: ');
  if (password !== confirm) {
    console.error('Passwords did not match.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  console.log('\nAdd this to phoenix-deer/.env:\n');
  console.log(`ADMIN_PASSWORD_HASH=${hash}`);
}

main();
