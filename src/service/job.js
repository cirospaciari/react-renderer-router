const scope = { routes: [], routes_file: null, html_file: null, babel_config: null, registerer_images: false, onCSS: [] };
const { default: register } = require('ignore-styles');
const path = require('path');
const fs = require('fs');
const map_cache = {};
module.exports = {
    async execute(params, reply) {


        register(undefined, function (module, filename) {

            const isImage = ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.jfif', '.pjpeg', '.pjp', '.tif', '.tiff', '.ico', '.cur', '.gif', '.bmp', '.apng']
                .some((ext) => filename.endsWith(ext));

            if (isImage) {

                const path = params.assets.img_path + filename.substr(module.path.length);
                if (params.assets.manifest) {
                    module.exports = require(params.assets.manifest)['files'][path.substr(1)];
                } else {
                    module.exports = path;
                }

            }
            
        });
        
        if (scope.babel_config !== params.babel_config) {
            require(params.babel_config);
            scope.babel_config = params.babel_config;
            scope.render = require('./renderer');
        }
        const max_memory = params.max_memory;
        const response = await scope.render(scope, params);
        const { heapUsed } = process.memoryUsage();
        reply({
            response,
            kill: heapUsed >= max_memory * 1024 * 1024
        });
    }
}
