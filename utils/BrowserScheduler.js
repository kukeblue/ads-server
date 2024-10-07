const Log = require('./Logger')
const logger = Log.getLogger('taskList_listener');
const axios = require('axios')
const adsHost = 'http://local.adspower.net:50325'
const puppeteer = require('puppeteer');

let isExecuting = false; // 用于标记是否请求正在进行中
let queue = []; // 队列来保存需要执行的请求
let maxBrowserScheduler = 5
const jsFilePath = path.resolve(__dirname, 'shein_2.js');
const jsContent = fs.readFileSync(jsFilePath, 'utf8');
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms)); // 延迟函数
}

class BrowserScheduler {
    groupMap = {}
    browsers = []
    results = {
    }
    taskList = []
    currentTaskNumber = -1

    constructor(taskName) {
        this.init()
    }
    checkResultStatus(vendor, html) {
        if (vendor.includes('ugg')) {
            if (html.includes('403 Forbidden') || html.includes('429 Too Many Requests') ||
                html.includes('https://ct.captcha-delivery.com/c2.js')
            ) {
                return {
                    status: 403
                }
            }
        }
        return {
            status: 200
        }
    }
    // 获取所有的浏览器状态
    async init() {
        logger.info(`开始初始化浏览器调度>>>>`)
        const res1 = await this.sendMessageToAds('/api/v1/group/list?page=1&&page_size=100', 'get')
        if (res1.status == 200 && res1.data.code == 0) {
            const list = res1.data.data.list

            list.forEach(item => {
                this.groupMap[item.group_name] = item.group_id
            });
        }

        logger.info(`初始化分组成功 ${Object.keys(this.groupMap).length} 个分组读取成功`)

        const res = await this.sendMessageToAds('/api/v1/user/list?page=1&&page_size=100', 'get')
        if (res.status == 200 && res.data.code == 0) {
            const list = res.data.data.list
            list.forEach(item => {
                this.browsers.push({
                    groupName: item.group_name,
                    userId: item.user_id,
                    status: 'pendding',
                    lastTime: null,
                })
            });
            logger.info(`初始化浏览器成功 ${this.browsers.length} 个浏览器被读取成功`)
        } else {
            logger.error(`请求ads失败 code ${res}`)
            process.exit(1);
        }
    }
    taskListListener() {
        setInterval(async () => {
            let deleteIndex = this.browsers.findIndex(item => item.status == 'delete')
            if (deleteIndex > -1) {
                this.browsers.splice(deleteIndex, 1);
            }
            if (this.currentTaskNumber != this.taskList.length) {
                this.currentTaskNumber = this.taskList.length
                logger.info(`当前队列中的任务数量：${this.taskList.length}`);
                if (this.taskList.length > 0) {
                    const task = this.taskList.shift();
                    logger.info(`开始执行任务 ${task.url}`)
                    // 第一步查找已经存在的环境
                    let penddingBrowsers = null
                    const exitBrowsers = this.browsers.filter(item => {
                        let group_flag = item.groupName == task.vendor
                        if (group_flag && !penddingBrowsers && item.status == 'pendding') {
                            penddingBrowsers = item
                        }
                        return group_flag
                    })
                    logger.info(`当前vendor ${task.vendor} 存在的浏览器数量为 ${exitBrowsers.length}`)
                    if (penddingBrowsers) {
                        logger.info(`任务 ${task.url} 匹配到浏览器 ${penddingBrowsers.userId}`)
                        penddingBrowsers.status = 'running'
                        penddingBrowsers.lastTime = new Date().getTime()
                        this.executeTask(task, penddingBrowsers)
                    } else {
                        logger.warn(`任务 ${task.url} 未匹配到浏览器`)

                        if (exitBrowsers.length < maxBrowserScheduler) {
                            const res = await this.sendMessageToAds('/api/v1/user/create', 'post', {
                                "name": task.vendor,
                                "proxyid": 'random',
                                "group_id": this.groupMap[task.vendor]
                            })
                            if (res.status == 200 && res.data.code == 0) {

                                logger.warn(`创建浏览器成功 ${task.vendor}`)
                                const ret = res.data.data
                                this.browsers.push({
                                    groupName: task.vendor,
                                    userId: ret.id,
                                    status: 'pendding',
                                    lastTime: null,
                                })
                                this.taskList.push(task)
                                this.currentTaskNumber--
                                logger.warn(`任务重新添加到任务列表成功！`)
                            } else {
                                this.results[task.url] = '500:no browsers'
                            }
                        } else {
                            if (task.waitCount) {
                                logger.warn(`任务 ${task.url} 重试次数为 ${task.waitCount}`)
                                task.waitCount++
                            } else {
                                logger.warn(`任务 ${task.url} 开始重试`)
                                task.waitCount = 1
                            }
                            if (!task.waitCount || task.waitCount < 2) {
                                this.currentTaskNumber--
                                logger.warn(`任务 ${task.url} 重新添加到等待列表`)
                                this.taskList.push(task)
                            } else {
                                logger.warn(`任务 ${task.url} 等待超时，设置500`)
                                this.results[task.url] = '500:no browsers'
                            }
                            // 否则直接超时
                        }
                    }
                }
            }
        }, 1000);
    }
    addTask(task = {
        vendor: '',
        url: '',
    }) {
        if (task.vendor && task.url) {
            this.taskList.push(task)
        }
    }
    async getResult(url) {
        return new Promise((resolve, reject) => {
            let seconds = 0;
            // 每秒执行一次
            const intervalId = setInterval(() => {
                seconds += 1;
                if (this.results[url]) {
                    const data = this.results[url]
                    delete this.results[url]
                    resolve(data);
                } else {
                    // 当到达 30 秒时，返回结果并清除定时器
                    if (seconds === 60) {
                        clearInterval(intervalId);
                        reject("获取结果超时");
                    }
                }
            }, 1000);
        });
    }

    doDeleteBrowser(penddingBrowsers) {
        this.sendMessageToAds(`/api/v1/browser/stop?user_id=${penddingBrowsers.userId}`, 'get').then((res) => {
            console.log(res.data)
            logger.info(`再次关闭浏览器成功:${penddingBrowsers.userId}`)
            setTimeout(()=>{
                this.sendMessageToAds(`/api/v1/user/delete`, 'post', { user_ids: [penddingBrowsers.userId] }).then(res => {
                    if(res.data.code == 0) {
                        logger.info(`再次删除浏览器成功:${penddingBrowsers.userId}`)
                    }else {
                        logger.error(`再次删除浏览器失败:${penddingBrowsers.userId}`)
                    }
                })
            }, 2000)
        })
    }

    deleteBrowser(penddingBrowsers) {
        this.sendMessageToAds(`/api/v1/browser/stop?user_id=${penddingBrowsers.userId}`, 'get').then((res) => {
            console.log(res.data)
            logger.info(`关闭浏览器成功:${penddingBrowsers.userId}`)
            setTimeout(()=>{
                this.sendMessageToAds(`/api/v1/user/delete`, 'post', { user_ids: [penddingBrowsers.userId] }).then(res => {
                    if(res.data.code == 0) {
                        logger.info(`删除浏览器成功:${penddingBrowsers.userId}`)
                    }else {
                        logger.error(`删除浏览器失败:${penddingBrowsers.userId}`)
                        this.doDeleteBrowser(penddingBrowsers)
                    }
                })
            }, 2000)
        })
    }


    async executeSheinTask(task, penddingBrowsers) {
        
        const { url, vendor } = task
        const result = {}
        this.sendMessageToAds(`/api/v1/browser/start?user_id=${penddingBrowsers.userId}&&open_tabs=1&&headless=0&&clear_cache_after_closing=1`, 'get')
            .then((async res => {
                if (res.status == 200 && res.data.code == 0) {
                    logger.info(`浏览器启动成功 端口:${res.data.data.debug_port}`)
                    let puppeteerUrl = res.data.data.ws.puppeteer
                    const browser = await puppeteer.connect({
                        browserWSEndpoint: puppeteerUrl,
                        defaultViewport: null
                    });
                    // 获取所有已经打开的页面
                    const pages = await browser.pages();
                    // 使用第一个页面
                    const page = pages[0];
                    // 读取本地的 shein_2.js 文件内容
                    
                    // 启用请求拦截
                    await page.setRequestInterception(true);
                
                    // 拦截特定的 JavaScript 文件并替换内容
                    page.on('request', (request) => {
                        const url = request.url();
                        if (url.endsWith('81960-d6561fcee6ba2f3b.js')) {
                            console.log(`替换js成功: ${url}`);
                            // 替换为本地的 shein_2.js 文件内容，并添加 CORS 头
                            request.respond({
                                status: 200,
                                contentType: 'application/javascript',
                                headers: {
                                    'Access-Control-Allow-Origin': '*',  // 允许跨域访问
                                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                                    'Access-Control-Allow-Headers': 'Content-Type'
                                },
                                body: jsContent,  // 替换为自定义的 JS
                            });
                        } else {
                            // 允许其他资源正常加载
                            request.continue();
                        }
                    });
                
                    // 在第一个页面中导航到目标网站
                    page.on('response', async (response) => {
                        const url = response.url();
                        if (url.includes('productInfo/quickView/get')) {
                            try {
                                const jsonResponse = await response.json();  // 获取响应的 JSON 数据
                                console.log(`Intercepted JSON from ${url}:`, jsonResponse);
                            
                            } catch (error) {
                                console.error('Error parsing JSON response:', error);
                            }
                        }
                    });
                    await page.goto('https://de.shein.com');
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    await page.evaluate(() => {
                        let elements = document.querySelectorAll('.j-vue-coupon-package-container.c-vue-coupon');
                        elements.forEach(element => element.remove());
                        elements = document.querySelectorAll('.sui-modal.sui-modal__dialog');
                        elements.forEach(element => element.remove());
                    });
                    // 滚动到页面底部
                    await page.evaluate(() => {
                        window.scrollTo(0, document.body.scrollHeight);
                    });
                    //   await page.waitForNetworkIdle({idleTime: 5000});  // 等待网络空闲
                    await page.waitForSelector('.product-card__add-btn.price-wrapper__addbag-btn');
                    // 点击第一个 class="product-card__add-btn price-wrapper__addbag-btn" 的按钮
                    await page.click('.product-card__add-btn.price-wrapper__addbag-btn');
                    await page.waitForSelector('.quick-view__info', {
                        visible: true,  // 等待元素变得可见
                        timeout: 30000  // 超时时间设置为 30 秒（默认为 30 秒）
                    });
                    // 在页面上下文中执行自定义的 JavaScript
                    await page.evaluate(() => {
                        window.ch.currentGoodsId = "11867229";
                        console.log('Set window.ch.currentGoodsId to "11867229"');
                    });
                    await new Promise(resolve => setTimeout(resolve, 30000));
                    // 断开 Puppeteer 与浏览器的连接，但不关闭浏览器
                    await browser.disconnect();
                }
            })).catch(e => {
                this.results[url] = '500:浏览器启动失败'
                console.error(e)
                const copy = JSON.parse(JSON.stringify(penddingBrowsers));
                this.deleteBrowser(copy)
                
                penddingBrowsers.status = 'delete'
                console.error(e)
                logger.error(`浏览器启动失败`)
            })


        



    }

    executeTask(task, penddingBrowsers) {
        // 启动浏览器
        const { url, vendor } = task

        this.sendMessageToAds(`/api/v1/browser/start?user_id=${penddingBrowsers.userId}&&open_tabs=1&&headless=0&&clear_cache_after_closing=1`, 'get')
            .then((async res => {
                if (res.status == 200 && res.data.code == 0) {
                    logger.info(`浏览器启动成功 端口:${res.data.data.debug_port}`)
                    let puppeteerUrl = res.data.data.ws.puppeteer
                    logger.info(`浏览器启动成功 puppeteerUrl${puppeteerUrl}`)

                    const browser = await puppeteer.connect({
                        browserWSEndpoint: puppeteerUrl,
                        defaultViewport: null
                    });
                    const pages = await browser.pages();
                    const page = pages[0];
                    await page.goto(url);
                    const result = await page.content();
                    await browser.disconnect();
                    logger.info(`设置${url}结果成功`)

                    const { status } = this.checkResultStatus(vendor, result)
                    if (status == 403) {
                        this.results[url] = '403:' + result
                    } else {
                        this.results[url] = result
                    }
                    if (status == '403') {
                        logger.info(`页面出现403开始删除浏览器`)
                        const copy = JSON.parse(JSON.stringify(penddingBrowsers));
                        this.deleteBrowser(copy)
                        penddingBrowsers.status = 'delete'
                    } else {
                        penddingBrowsers.status = 'pendding'
                    }

                }
            })).catch(e => {
                this.results[url] = '500:浏览器启动失败'
                console.error(e)
                const copy = JSON.parse(JSON.stringify(penddingBrowsers));
                this.deleteBrowser(copy)
                
                penddingBrowsers.status = 'delete'
                console.error(e)
                logger.error(`浏览器启动失败`)
            })
    }


    async sendMessageToAds(url, method, data) {
        if (isExecuting) {
            return new Promise((resolve, reject) => {
                // 如果有任务正在执行，将新任务放入队列
                queue.push({ url, method, data, resolve, reject });
            });
        }

        isExecuting = true;
        try {
            await delay(500); // 等待 500 毫秒（0.5秒）

            // 发送 HTTP 请求
            const result = await axios[method](adsHost + url, data);

            // 任务完成，设置 isExecuting 为 false
            isExecuting = false;

            // 如果队列中有更多任务，处理下一个任务
            if (queue.length > 0) {
                const nextRequest = queue.shift(); // 取出队列中的下一个任务
                this.sendMessageToAds(nextRequest.url, nextRequest.method, nextRequest.data)
                    .then(nextRequest.resolve)
                    .catch(nextRequest.reject); // 处理下一个任务
            }

            return result; // 返回请求结果
        } catch (error) {
            isExecuting = false;

            // 确认错误处理时也检查队列
            if (queue.length > 0) {
                const nextRequest = queue.shift(); // 继续处理队列中的任务
                this.sendMessageToAds(nextRequest.url, nextRequest.method, nextRequest.data)
                    .then(nextRequest.resolve)
                    .catch(nextRequest.reject);
            }

            throw error; // 抛出异常
        }
    }
}

const browserScheduler = new BrowserScheduler()
module.exports = browserScheduler