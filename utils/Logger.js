const log4js = require('log4js');


log4js.configure({
  appenders: {
    console: { type: 'console' },
    taskList_listener: { type: 'console' },
    // infoFile: { type: 'file', filename: 'app.log' },
    // errorFile: { type: 'file', filename: 'errors.log' }
  },
  categories: {
    default: { appenders: ['console'], level: 'info' },
    default: { appenders: ['taskList_listener'], level: 'info' }

    // error: { appenders: ['console', 'errorFile'], level: 'error' }
  }
});

module.exports = log4js

// // 默认日志记录器
// const logger = log4js.getLogger();

// // 错误日志记录器
// const errorLogger = log4js.getLogger('error');

// // 正常日志
// logger.info('这是一条信息日志');

// // 错误日志
// errorLogger.error('这是一条错误日志');