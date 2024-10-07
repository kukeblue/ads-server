const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const indexRouter = require('./routes/index');
const usersRouter = require('./routes/users');
const chalk = require('chalk');
const app = express();
// 启动浏览器调度监听
const browserScheduler = require('./utils/BrowserScheduler');
setTimeout(()=>{
  browserScheduler.taskListListener()
}, 3000)



// 自定义 Token 来记录当前的本地时间
morgan.token('local-date', function () {
  return new Date().toLocaleString();
});

// 自定义 Token 来处理状态码，并为不同范围的状态码设置不同的颜色
morgan.token('colored-status', function (req, res) {
  const status = res.statusCode;
  
  if (status >= 500) {
    return chalk.red(status); // 5xx 错误 - 红色
  } else if (status >= 400) {
    return chalk.yellow(status); // 4xx 错误 - 黄色
  } else if (status >= 300) {
    return chalk.cyan(status); // 3xx 重定向 - 青色
  } else if (status >= 200) {
    return chalk.green(status); // 2xx 成功 - 绿色
  }
  return status;
});

// 自定义日志格式，包含当前时间、HTTP 方法、URL、状态码（带颜色）和响应时间
const customFormat = ':local-date :method :url :colored-status :response-time ms';

// 注册 morgan 中间件，只输出自定义格式
app.use(morgan(customFormat));


// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/users', usersRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
