const scope = { routes: [], routes_file: null, html_file: null, babel_config: null, registerer_images: false, onCSS: [] };
const { default: register } = require('ignore-styles');
const path = require('path');
const fs = require('fs');
const { setImmediate } = require('timers');
const map_cache = {};
module.exports = {
    async execute(params, reply) {


        const img_extensions = ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.jfif', '.pjpeg', '.pjp', '.tif', '.tiff', '.ico', '.cur', '.gif', '.bmp', '.apng'];
        const extensions = [ '.css', '.scss', '.sass', ...img_extensions];
        register(extensions, function (module, filename) {

            const isImage = img_extensions.some((ext) => filename.endsWith(ext));

            if (isImage) {

                const path = params.assets.img_path + filename.substr(module.path.length);
                if (params.assets.manifest) {
                    module.exports = require(params.assets.manifest)['files'][path.substr(1)];
                } else {
                    module.exports = path;
                }

            }
            //need support to scss and sass
            //https://create-react-app.dev/docs/adding-a-sass-stylesheet
            if(['.css', 'scss' ,'.sass'].some((ext) => filename.endsWith(ext))){
                module.parent.exports.__css = module.parent.exports.__css || []

                let common_path = params.assets.css_path + filename.substr(module.path.length);
                if (params.assets.manifest) {
                    const source_name = filename.substr(module.path.length + 1);

                    Object.entries(require(params.assets.manifest)['files']).forEach((parts)=>{
                        const [ key, value ] = parts;
                        if(key.endsWith('.css.map')){
                            map_cache[key] = map_cache[key] || JSON.parse(fs.readFileSync(path.dirname(params.assets.manifest) + '/' + key, 'utf8'));
                            if(map_cache[key].sources.some((file)=> file === source_name)){
                                module.parent.exports.__css.push(path.dirname(value) + '/' + map_cache[key].file);
                            }
                        }

                    })
                }else{
                    module.parent.exports.__css.push(common_path);
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

