var pth = require('path');
var fs = require('fs');
var buildUtil = require('./util');
var inherit = require('../inherit');

var _mid = 0;

var canNew = false;

var moduleCaches = {},
	uriCaches = {};


function getMid(){
	return 'module-' + _mid++;
}


function deepDependency(_module, alldeps){
	_module.deps.forEach(function(depModule){
		depModule.alldeps.forEach(function(mod){
			if(alldeps.indexOf(mod) < 0) alldeps.push(mod);
		});
		if(alldeps.indexOf(depModule) < 0) alldeps.push(depModule);
	});
	return alldeps;
}


// 模板模块的 uri 结尾没有 .js
var Module = inherit({
	/**
	 *
	 * @param {String} uri
	 * @param {Boolean} isMain
	 * @param {Module} requiredBy
	 * @constructor
	 */
	__constructor: function(opt){
		this.uri = opt.uri;
		// isMain 和 requiredBy 是互斥的
		this.isMain = opt.isMain;
		this.requiredBy = [];
		this.addRequiredBy(opt.requiredBy);

		this.mid = getMid();
		if(buildUtil.isRemoteUri(this.uri)){
			this.isRemote = true;
			this.baseInfo();
			this.uri_nux = this.uri;
			this.deps = this.alldeps = [];
		}
		else{
			this._check();
			this.baseInfo().dealDependency().deepDependencies();//.transport();
		}
	},
	isRequireJsModule: function(){
		return this.moduleType == 'requirejs';
	},
	_check: function(){
		if(!canNew) vacation.log.error('you should use Module.get to initialize a Module.');

		var tpl;
		if(tpl = this.uri.match(buildUtil.IS_TPL)){
			this.isTpl = true;
			// uri 需要去除 .js 结尾
			if(tpl[2]){
				this.uri = this.uri.substr(0, this.uri.length - 3);
			}
		}

		// uri 被缓存，但模块没有被缓存，一定是循环引用了
		if(uriCaches[this.uri]) vacation.log.error('circle dependencies.');
		uriCaches[this.uri] = true;

		// 检查依赖文件是否存在
		var depIsExists = fs.existsSync(this.uri);
		if(!depIsExists) {
			var info = this.isMain ? 'is main module' : ('required by "'+(this.requiredBy[0] ? this.requiredBy[0].uri : '')+'"');
			vacation.log.error('[425-1] module('+this.uri+')('+info+') is not exists.');
		}
		return this;
	},
	setPackage: function(package){
		this.package = package;
		return this;
	},
	addRequiredBy: function(mod){
		if(mod) this.requiredBy.push(mod);
		return this;
	},
	baseInfo: function(){
		var uri = this.uri;
		var conf = buildUtil.getBuildConfig();
		// 顶级标识都必须相对于 base 路径来解析
		var relative = pth.relative(conf.base, uri);
		var moduleId, idType;

		var matched = [];
		// real_alias_rootPathed 已经将 alias、paths 基于 configFileDir 转为根路径
		buildUtil.each(conf.real_alias_rootPathed, function(aliasRootPath, key){
			// requireJS paths 可以配置文件别名，而且，还不能以 .js 结尾
			if(aliasRootPath == uri || (aliasRootPath+'.js') == uri || pth.relative(aliasRootPath, uri).indexOf('..') !== 0)
				matched.push([key, aliasRootPath]);
		});
		// 此模块有设置 alias 或 pahts
		if(matched.length > 0){
			// 按 aliasRootPath 的长度排序，越长越靠前。
			matched.sort(function(a,b){
				return a[1].length - b[1].length < 0;
			});
			// resolve 返回的结果(matched[0][1])，是已经去除掉最后一个'/'字符的
			moduleId = uri.replace(matched[0][1], matched[0][0]);
			idType = 'real_alias';
		}
		// 此模块ID 可以使用顶级标识
		if(relative.indexOf('.') !== 0){
			// 如果已经有 alias、paths ID，可以使用多个ID，则使用短的
			if(!moduleId || moduleId.length >= relative.length){
				moduleId = relative;
				idType = 'top';
			}
		}
		// 如果只能使用相对路径做标识ID，则报错
		if(!moduleId){
			console.log('\n [HELP INFO] paths and alias is parsed to: ' + JSON.stringify(conf.real_alias_rootPathed, null, 4));
			var info = this.isMain ? 'is main module' : ('required by "'+(this.requiredBy[0] ? this.requiredBy[0].uri : '')+'"');
			vacation.log.error('[423] module(uri:'+uri+')('+info+') not in the base directory('+conf.base+'), and no paths or alias relative to its path.');
		}


		this.distUri = pth.resolve(conf.dist, pth.relative(conf.src, this.uri));
		// linux 风格路径
		this.uri_nux = buildUtil.normalize_win_dir(this.uri);
		this.id = buildUtil.normalize_win_dir(moduleId);
		/**
		 * requireJS 的规则：
		 *
		 * There may be times when you do want to reference a script directly
		 * and not conform to the "baseUrl + paths" rules for finding it.
		 * If a module ID has one of the following characteristics,
		 * the ID will not be passed through the "baseUrl + paths" configuration,
		 * and just be treated like a regular URL that is relative to the document:
		 *  *   Ends in ".js".
		 *  *   Starts with a "/".
		 *  *   Contains an URL protocol, like "http:" or "https:".
		 *
		 *  总之一句话，如果要用 baseUrl 的话，ID 就不要以 .js 结尾
		 *
		 *  而 seajs 很宽松，不以 .js 结尾，也会自动加上 .js（除非添加了插件，识别的某些类型的文件，如 seajs-text 等）
	     */
		this.distId = buildUtil.normalize_dist_id(this.id);//this.isTpl ? (this.id + '.js') : this.id;
		this.idType = idType;
		this.type = uri.substr(uri.lastIndexOf('.') + 1).toLowerCase();
		this.filename = pth.basename(uri, '.' + this.type);
		this.inBase = relative.indexOf('.') !== 0;
		this.inSrc = pth.relative(conf.src, uri).indexOf('.')!==0;
		return this;
	},
	updateContent: function(){
		this.originContent = buildUtil.readFile(this.uri);
		return this;
	},
	// 默认的（模版模块可以使用），需要被子类重写
	_getDependenciesIdFromContent: function(){
		return [];
	},
	dealDependency: function(){
		var conf = buildUtil.getBuildConfig();
		var moduleContent = this.updateContent().originContent;

		var deps = [];
		if(this.type == 'js'){
			// 删除注释和多余的空白等
			var uglifiedContent = buildUtil.getUglifiedContent(moduleContent, {
				fromString: true,
				mangle: false,
				compress: false
			}, this.uri);
			this.cmd = this._getCmd(uglifiedContent);

			// 非 CMD 标准模块不能依赖其他模块，只能被其他模块所依赖
			if(this.cmd === 0){
				var requiredModules = this._getDependenciesIdFromContent(uglifiedContent);
				requiredModules.forEach(function(depModuleFile){
					var useAlias;

					var aliasedPath = buildUtil.get_real_path_by_alias(depModuleFile, conf.real_alias);
					if(depModuleFile != aliasedPath){
						useAlias = true;
					}
					depModuleFile = buildUtil.addExtraNameToFile(aliasedPath);

					// 依赖文件的
					var depModuleRelativeTo, isRemote;
					// 相对路径
					if(depModuleFile.indexOf('.') == 0){
						// 这里 seajs 是这样，requirejs 尚未验证
						if(useAlias){
							// seajs.config 中 alias 和 paths 是先解析后，根据相对当前模块来解析
							// 不过在 vacation 中，是相对于 config file dir 来解析的
							depModuleRelativeTo = vacation.cli.configFileDir;
						}
						// seajs 和 requirejs 的 define，相对路径：相对于当前模块
						else if(!this.isRequireJsModule() || this.isModuleDefined()){
							depModuleRelativeTo = pth.dirname(this.uri);
						}
						// requirejs 的 require，相对于 base 路径
						else{
							depModuleRelativeTo = conf.base;
						}
					}
					// 根路径：相对于 conf.www 目录
					else if(depModuleFile.indexOf('/') == 0){
						depModuleRelativeTo = conf.www;
						if(!conf.www) vacation.log.error('[424] module('+moduleInfo.uri+') require('+depModuleFile+') but the www directory is not config.');
					}
					else if(buildUtil.isRemoteUri(depModuleFile)){
						isRemote = true;
					}
					// 顶级标识：相对于 base 基础路径
					else {
						depModuleRelativeTo = conf.base;
					}

					var depModuleURI = isRemote ? depModuleFile : pth.resolve(depModuleRelativeTo, depModuleFile);
					var depModule = this.__self.get({
						uri:depModuleURI,
						requiredBy: this
					});
					deps.push(depModule);
				}.bind(this));
			}
		}
		this.deps = deps;
		return this;
	},
	deepDependencies: function(){
		this.alldeps = deepDependency(this, []);
		return this;
	},
	/*
	 * @param {Boolean} [optimize]
	 * @param {Number} [Handlebars = 0]
	 * */
	transport: function(){
		var opt = buildUtil.getOptions();
		var content = this.originContent;
		var distId = this.isMain ? this.package.distId : this.distId;
		if(this.isTpl){
			content = buildUtil.htmlMinify(content, {
				removeComments:opt.optimize,
				removeHandlebarsComments:opt.optimize,
				collapseWhitespace: opt.optimize
			});
			if(opt.Handlebars >= 2){
				var compiledTplFn = buildUtil.precompileTemplate(content, 'Handlebars', this.id);
				content = 'define("'+distId+'",[],function(require,exports,module){'
						+ 		'var fn = Handlebars.template('+compiledTplFn+');'
						+		'fn.___vacationPrecompiled = true;'
						+		'module.exports = fn;'
						+ '});';
			}
			else if(opt.underscore >= 2){
				var compiledTplFn = buildUtil.precompileTemplate(content, 'underscore', this.id);
				content = 'define("'+distId+'",[],function(){'
						+ 		'var fn = ' + compiledTplFn + ';'
						+		'fn.___vacationPrecompiled = true;'
						+		'return fn;'
						+ '});';
			}
			else{
				// 兼容 seajs 和 requirejs 的写法
				content = 'define("'+distId+'",[],function(){\n\treturn "'+buildUtil.content2StandardString(content)+'"});';
			}
		}
		// 对于源码里面的 对CSS文件的require不必理会，因为 seajs 发现require的模块如果是CSS，
		// 即便没有factory函数，没有exports值也没关系
		// [seajs源码]： if (exports === null && !IS_CSS_RE.test(uri)) { emit("error", mod) }
		else if(this.type == 'css'){
			if(opt.cssinline){
				if(opt.optimize) content = buildUtil.cssMinify(this.originContent);
				content = this.moduleType + '.importStyle("'+buildUtil.content2StandardString(content)+'");';
			}
			else content = '';
		}
		else if(this.type == 'js'){
			if(this.cmd == 0){
				content = this._getStandardJSModuleContent(content);
			}
			else if(this.cmd === -1){
				content = 'define("'+distId+'",[],function(){'+content+'});';
			}
		}
		// 已经是JS 的内容可以进行压缩优化
		if(opt.optimize && (this.type == 'js' || this.isTpl)){
			var conf = buildUtil.getBuildConfig();
			content = buildUtil.getUglifiedContent(content, {
				fromString: true,
				mangle: conf.uglify && conf.uglify.mangle || true,
				compress: true
			}, this.distId);
		}
		this.transportedContent = content;
		return this;
	}
},{
	/**
	 * @param {String} uri
	 * @param {Boolean} isMain
	 * @param {Module} requiredBy
	 */
	get: function(opt){
		canNew = true;
		if(!buildUtil.isURIAvailable(opt.uri)) vacation.log.error('uri('+opt.uri+') is ignored.');
		var _module;
		if(_module = moduleCaches[opt.uri]){
			// 已经缓存了，但可以更新 被谁依赖了
			if(opt.requiredBy) _module.addRequiredBy(opt.requiredBy);
		}
		else{
			_module = moduleCaches[opt.uri] = new this.prototype.__self(opt);
		}
		canNew = false;
		return _module;
	}
});

module.exports = Module;