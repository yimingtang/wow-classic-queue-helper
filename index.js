const axios = require('axios')
const chalk = require('chalk')
const fs = require('fs')
const notifier = require('node-notifier')
const sqlite3 = require('sqlite3')
const schedule = require('node-schedule')
const { exec } = require('child_process')
const config = require('./config.json')

const log = console.log

const DB_FILE_PATH = './db/data.db'
const API_URL = 'https://blz-service.blz.netease.com/external/classic/server/list'

let db = null

function setUp() {
  log(chalk.yellow('⏰Time: ' + new Date()))
  log(chalk.yellow('⚙️ Setting up…'))

  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(DB_FILE_PATH, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, error => {
      if (error) {
        log(chalk.red(`😢 [DB]: connection error: ${error.message}`))
        reject(error)
      } else {
        log(chalk.green('🔗[DB]: connected'))

        createTable()
          .then(resolve)
          .catch(reject)
      }
    })
  })
}

function runSQL(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, error => {
      if (error) {
        log(chalk.red('❌ Error running sql ' + sql))
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

function createTable() {
  log(chalk.yellow('📋[DB] creating table if needed...'))

  return runSQL(
    `CREATE TABLE IF NOT EXISTS "server" (
      "name"  TEXT,
      "id"  INTEGER PRIMARY KEY AUTOINCREMENT,
      "entity"  TEXT,
      "queue" INTEGER,
      "englishName" TEXT,
      "timestamp" INTEGER,
      "waitTime"  INTEGER
    )`
  )
}

function insertServers(servers, timestamp) {
  db.serialize(() => {
    let statement = db.prepare(
      'INSERT INTO server (entity ,name, englishName, queue, waitTime, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
    )
    for (const server of servers) {
      statement.run(
        [server.entity, server.name, server.nameEn, server.waitQueue, server.waitQueueTime, timestamp],
        error => {
          if (error) {
            log(chalk.red(`[DB]: insert error: ${error.message}`))
          } else {
            log(`[DB]: insert ${server.name} - ${server.waitQueue}`)
          }
        }
      )
    }
    statement.finalize(tearDown)
  })
}

function tearDown() {
  log(chalk.yellow('🎉 Updated successfully, now tearing down…'))
  db.close(error => {
    if (error) {
      log(chalk.red(`[DB] error occurred while closing connection: ${error.message}`))
    } else {
      log(chalk.green('[DB] connection closed'))
    }
  })
}

function isToday(date) {
  return date.toDateString() === new Date().toDateString()
}

function saveLastNotification(count, notificationEnabled) {
  const cache = {
    date: new Date(),
    serverName: config.serverName,
    queueThreshold: config.queueThreshold,
    queue: count,
    notificationEnabled,
  }

  fs.writeFileSync('./cache.json', JSON.stringify(cache), 'utf8')
}

function notify(count) {
  let cache
  try {
    cache = JSON.parse(fs.readFileSync('./cache.json', 'utf8'))
  } catch (error) {
    // DO nothing
  }

  if (cache && !cache.notificationEnabled && cache.date && isToday(new Date(cache.date))) {
    return
  }

  notifier.notify(
    {
      title: '怀旧服排队提醒小助手',
      message: `${config.serverName} 排队超过 ${config.queueThreshold} 啦！当前队列 ${count}。`,
      sound: true,
      timeout: 10,
      closeLabel: '知道了',
      actions: ['去排队', '今天不再提醒'],
      dropdownLabel: '更多',
    },
    (error, response, metadata) => {
      value = metadata.activationValue
      if (value === '去排队') {
        exec('open -a Battle.net.app')
        saveLastNotification(count, false)
      } else if (value === '今天不再提醒') {
        saveLastNotification(count, false)
      } else {
        saveLastNotification(count, true)
      }
    }
  )
}

function runJob() {
  setUp()
    .then(() => {
      axios
        .get(API_URL)
        .then(response => {
          servers = response.data.data
          const timestamp = +new Date()
          insertServers(servers, timestamp)
          for (const server of servers) {
            if (server.name === config.serverName && server.waitQueue > config.queueThreshold) {
              notify(server.waitQueue)
            }
          }
        })
        .catch(error => {
          log(chalk.red(`[Error]: ${error.message}`))
        })
    })
    .catch(error => {})
}

function main() {
  log(chalk.yellow('================== Running WoW Classic Queue Helper =============='))
  schedule.scheduleJob(`*/${config.timeInterval} * * * *`, () => {
    runJob()
  })
}

main()
