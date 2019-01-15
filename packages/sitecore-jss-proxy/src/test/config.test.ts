// general import statement makes TS compiler and linter happy when working in *.test.ts files
import 'mocha';

export default {
  apiHost: 'http://jssadvancedapp',
  apiKey: '{GUID}',
  layoutServiceRoute: '/sitecore/layoutsvc/render/jss',
  pathRewriteExcludeRoutes: ['/SITECORE/CONTENTSVC', '/SITECORE/LAYOUTSVC', '/SITECORE MODULES'],
  debug: true,
};
