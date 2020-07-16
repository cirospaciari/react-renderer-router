"use strict";

const {
  fork
} = require('child_process');

const path = require('path');

const crypto = require('crypto');

const byteToHex = [];

for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 0x100).toString(16).substr(1));
}

class RenderService {
  constructor(forks) {
    this.forks = forks || 2;
    this.active = -1;
    this.resolvers = new Map();
    this.renderers = Array.from({
      length: forks
    }, () => this.createRenderer());
  }

  uuidv4() {
    const rnds = crypto.randomFillSync(new Uint8Array(16)); // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`

    rnds[6] = rnds[6] & 0x0f | 0x40;
    rnds[8] = rnds[8] & 0x3f | 0x80;
    return (byteToHex[rnds[0]] + byteToHex[rnds[1]] + byteToHex[rnds[2]] + byteToHex[rnds[3]] + '-' + byteToHex[rnds[4]] + byteToHex[rnds[5]] + '-' + byteToHex[rnds[6]] + byteToHex[rnds[7]] + '-' + byteToHex[rnds[8]] + byteToHex[rnds[9]] + '-' + byteToHex[rnds[10]] + byteToHex[rnds[11]] + byteToHex[rnds[12]] + byteToHex[rnds[13]] + byteToHex[rnds[14]] + byteToHex[rnds[15]]).toLowerCase();
  }

  render(params) {
    return new Promise(resolve => {
      const id = this.uuidv4();
      let restartedProcess = false;
      let returned = false;

      const complete = (result, restart) => {
        if (!returned) {
          returned = true;
          this.resolvers.delete(id);
          resolve(result);
        }

        if (!restartedProcess && restart) {
          restartedProcess = true;
          this.restartRenderer();
        }
      };

      try {
        let renderer = this.getRenderer();

        if (!renderer || renderer.exitCode !== null) {
          console.error('Failed to start SSR renderer process');
          complete({
            html: '',
            context: {
              error: 'Failed to start SSR renderer process',
              status: 500
            }
          }, true);
        }

        renderer.once('message', res => {
          complete(res.response, res.kill);
        });
        renderer.once('error', error => {
          complete({
            html: '',
            context: {
              error,
              status: 500
            }
          }, true);
        });
        renderer.once('exit', code => {
          complete({
            html: '',
            context: {
              error: 'SSR fork renderer process exited with code ' + code,
              status: 500
            }
          }, true);
        });

        if (!this.resolvers.has(id)) {
          renderer.setMaxListeners(Infinity);
          this.resolvers.set(id, resolve);
          renderer.send({
            id,
            ...params
          }, null, {}, error => {
            if (error) {
              complete({
                html: '',
                context: {
                  error,
                  status: 500
                }
              }, true);
            }
          });
        } else {
          complete({
            html: '',
            context: {
              error: 'SSR Failed to send request',
              status: 500
            }
          }, true);
        }
      } catch (error) {
        this.resolvers.delete(id);
        console.error(error);
        resolve({
          html: '',
          context: {
            error,
            status: 500
          }
        });
      }
    });
  }

  getRenderer() {
    let count = 0;
    this.next(); //get next to balance requests

    do {
      const renderer = this.renderers[this.active];

      if (renderer && renderer.exitCode === null) {
        //renderer is available :D
        return renderer;
      } //restart and try again


      this.restartRenderer();
      count++;
    } while (count < this.forks); //no renderer available so... restart and try one more time!


    return this.restartRenderer();
  }

  createRenderer() {
    return fork(path.join(__dirname, './service/fork.js'));
  }

  restartRenderer() {
    if (this.active < 0) {
      this.next();
      return this.renderers[this.active];
    }

    const renderer = this.renderers[this.active];
    this.renderers[this.active] = this.createRenderer();

    try {
      if (renderer && renderer.exitCode === null) {
        renderer.kill();
      }
    } catch (ex) {
      console.error('Failed to kill SSR renderer process', ex);
    }

    this.next();
    return this.renderers[this.active];
  }

  next() {
    if (this.active === this.forks - 1) {
      this.active = 0;
    } else {
      this.active++;
    }
  }

}

module.exports = RenderService;