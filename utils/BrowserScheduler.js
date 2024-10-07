const Log = require('./Logger')
const logger = Log.getLogger('taskList_listener');
const axios = require('axios')
const adsHost = 'http://local.adspower.net:50325'
const puppeteer = require('puppeteer');

let isExecuting = false; // 用于标记是否请求正在进行中
let queue = []; // 队列来保存需要执行的请求
let maxBrowserScheduler = 5
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
        if(vendor.includes('ugg')) {
            if(html.includes('403 Forbidden')) {
                return {
                    status: 403
                }
            }
        }
        return  {
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
            let deleteIndex = this.browsers.findIndex(item=>item.status == 'delete')
            if(deleteIndex > -1) {
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
    executeTask(task, penddingBrowsers) {
        // 启动浏览器
        const { url, vendor } = task

        this.sendMessageToAds(`/api/v1/browser/start?user_id=${penddingBrowsers.userId}&&open_tabs=1&&headless=0&&clear_cache_after_closing=1`, 'get')
            .then((async res=>{
                if(res.status == 200 && res.data.code == 0) {
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
                    
                    const {status} = this.checkResultStatus(vendor, result)
                    if(status == 403) {
                        this.results[url] = '403:' + result
                    }else {
                        this.results[url] = result
                    }
                    if(status == '403') {
                        logger.info(`页面出现403开始删除浏览器`)
                        this.sendMessageToAds(`/api/v1/browser/stop?user_id=${penddingBrowsers.userId}`, 'get').then((res)=>{
                            console.log(res.data)
                            logger.info(`关闭浏览器成功:${penddingBrowsers.userId}`)
                            this.sendMessageToAds(`/api/v1/user/delete`, 'post', {user_ids: [penddingBrowsers.userId]}).then(res=>{
                                console.log(res.data)
                                logger.info(`删除浏览器成功:${penddingBrowsers.userId}`)
                            })
                        })
                        penddingBrowsers.status = 'delete'
                    }else {
                        penddingBrowsers.status = 'pendding'
                    }
                    
                }
            })).catch(e=>{
                this.sendMessageToAds(`/api/v1/browser/stop?user_id=${penddingBrowsers.userId}`, 'get').then((res)=>{
                    console.log(res.data)
                    logger.info(`关闭浏览器成功:${penddingBrowsers.userId}`)
                    this.sendMessageToAds(`/api/v1/user/delete`, 'post', {user_ids: [penddingBrowsers.userId]}).then(res=>{
                        console.log(res.data)
                        logger.info(`删除浏览器成功:${penddingBrowsers.userId}`)
                    })
                })
                this.results[url] = '500:浏览器启动失败'
                penddingBrowsers.status = 'delete'
                console.error(e)
                logger.error(`浏览器启动失败`)
            }) 
    }
    async sendMessageToAds(url, method, data) {
        if (isExecuting) {
            return new Promise((resolve, reject) => {
                queue.push({ url, resolve, reject }); // 如果有任务正在执行，将新任务放入队列
            });
        }
        isExecuting = true;
        try {
            await delay(500); // 等待 1 秒
            const result = await axios[method](adsHost + url, data); // 执行请求
            isExecuting = false;
            // 查看队列中是否有下一个任务
            if (queue.length > 0) {
                const nextRequest = queue.shift(); // 取出队列中的下一个任务
                sendMessageToAds(nextRequest.url)
                    .then(nextRequest.resolve)
                    .catch(nextRequest.reject); // 处理下一个任务
            }
            return result; // 返回结果
        } catch (error) {
            isExecuting = false;
            throw error;
        }
    }
}

const browserScheduler = new BrowserScheduler()
module.exports = browserScheduler