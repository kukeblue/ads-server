const express = require('express');
const router = express.Router();
const browserScheduler = require('../utils/BrowserScheduler');
/* GET home page. */
router.get('/', function (req, res, next) {
  res.render('index', { title: 'Express' });
});

// /get_html?vendor=xxx&url=xxx 接口
router.get('/get_html', (req, res) => {
  // 从查询参数中获取 vendor 和 url
  const { vendor, url } = req.query;

  // 检查必填参数
  if (!vendor || !url) {
    return res.status(500).json({
      error: 'Missing required query parameters: vendor and url are required'
    });
  }
  const task = { vendor, url }
  browserScheduler.addTask(task)
  browserScheduler.getResult(url).then((data) => {
    if (data.startsWith('500:')) {
      res.status(500).send(data);
    } else if (data.startsWith('403:')) {
      res.status(403).send(data.replace('403:', ''));
    }
    else {
      res.status(200).type('text/plain').send(data);
    }
  }).catch((e) => {
    console.log(e)
    res.status(403).send('403');
  })

});

module.exports = router;
