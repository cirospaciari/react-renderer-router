"use strict";

const path = require('path');

const {
  Concurrent
} = require('simplified-concurrence');

class RenderService {
  constructor(instances, type) {
    this.instances = instances || 2;
    this.active = -1;
    this.type = type || 'thread';
    this.renderers = Array.from({
      length: instances
    }, () => this.createRenderer());
  }

  async render(params) {
    try {
      const renderer = await this.getRenderer();
      const result = await renderer.send(params);

      if (result.kill && !renderer.isRestarting()) {
        //restart
        renderer.restart();
      }

      return result.response;
    } catch (ex) {
      console.log(ex);
      return {
        html: '',
        context: {
          error: ex.error,
          status: 500
        }
      };
    }
  }

  getRenderer() {
    this.next(); //get next to balance requests

    const renderer = this.renderers[this.active];
    return new Promise(resolve => {
      const check = () => {
        if (renderer.isRestarting()) {
          return setImmediate(() => check());
        }

        resolve(renderer);
      };

      check();
    });
  }

  createRenderer() {
    return new Concurrent(this.type, path.join(__dirname, './service/job.js'), true);
  }

  next() {
    let next;

    if (this.active === this.instances - 1) {
      next = 0;
    } else {
      next = this.active + 1;
    } //only go to next if next its available


    if (!this.renderers[next].isRestarting()) {
      this.active = next;
    }
  }

}

module.exports = RenderService;