const path = require('path');
const { Concurrent } = require('simplified-concurrence');


class RenderService {
  constructor(instances, type) {
    this.instances = instances || 2;
    this.active = -1;
    this.type = type || 'thread';

    this.renderers = Array.from({ length: instances }, () => this.createRenderer());
  }

  async render(params) {
    try {
      const renderer = await this.getRenderer();

      const result = await renderer.send(params);

      if (result.kill){
        this.restartRenderer();
      }

      return result.response;
    } catch (error) {
      console.error(error);
      return { html: '', context: { error, status: 500 } };
    }
  }

  getRenderer() {

    this.next();//get next to balance requests
    const renderer = this.renderers[this.active];

    return new Promise((resolve) => {

      const check = () => {
        if (this.restarting) {
          return setImmediate(() => check());
        }
        resolve(renderer);
      }

      check();
    });
  }

  createRenderer() {
    return new Concurrent(this.type, path.join(__dirname, './service/job.js'), true);
  }

  async restartRenderer() {
    if (this.active < 0) {
      this.active = 0;
      return this.renderers[this.active];
    }

    const renderer = this.renderers[this.active];
    this.next();
    try {
      if (!renderer.restarting) {
        renderer.restarting = true;
        //restart
        await renderer.terminate();
        //set keepAlive again because terminate turn keepAlive off
        renderer.keepAlive = true;
        renderer.start();

        renderer.restarting = false;
      }
    } catch (ex) {
      console.error('Failed to restart SSR renderer process', ex);
    }

    return this.renderers[this.active];
  }

  next() {
    let next;
    if (this.active === this.instances - 1) {
      next = 0;
    } else {
      next = this.active + 1;
    }
    //only go to next if next its available
    if (!this.renderers[next].restarting) {
      this.active = next;
    }
  }
}

module.exports = RenderService; 