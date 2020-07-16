

const scope = { routes: [], routes_file: null, html_file: null, babel_config: null, registerer_images: false };
const { default: register } = require('ignore-styles');

process.on('message', async params => {
    if (!scope.registerer_images) {
        scope.registerer_images = true;

        register(undefined, function (module, filename) {

            if (!params.remove_images) {
                const isImage = ['.svg', '.png', '.jpg', '.jpeg', '.webp','.jfif', '.pjpeg', '.pjp', '.tif', '.tiff', '.ico', '.cur', '.gif', '.bmp', '.apng']
                    .some((ext) => filename.endsWith(ext));

                if (isImage) {

                    const path = params.assets.path + filename.substr(module.path.length);
                    if (params.assets.manifest) {
                        module.exports = require(params.assets.manifest)['files'][path.substr(1)];
                    } else {
                        module.exports = path;
                    }

                }
            }
        });
    }
    if (scope.babel_config !== params.babel_config) {
        require(params.babel_config);
        scope.babel_config = params.babel_config;
        scope.render = require('./renderer');
    }


    scope.render(scope, params, (id, response, max_memory) => {
        const { heapUsed } = process.memoryUsage();
        if (process.send) {
            process.send({
                id,
                response,
                kill: heapUsed >= max_memory * 1024 * 1024
            },
            null,
            {},
            error => {
              if (error !== null) console.error('SSR: Fail to send response', error);
            }
          );
        }
    });
});
