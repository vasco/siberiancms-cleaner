const mysql = require('mysql2/promise')
const request = require('request-promise')
const Bottleneck = require('bottleneck')

function config(name, dft=undefined) {
  const prop = process.env[name]
  if (!!prop || !!dft) {
    return prop || dft
  }
  throw new Error(`Missing env parameter '${name}'`)
}

/**/
const dbconfig = {
  host: config('HOST'),
  dbname: config('DB'),
  username: config('USER'),
  password: config('PASS'),
  port: config('PORT', '3306'),
}
const siberianRoot = config('SIBERIANCMS')
const maxConcurrent = config('MAX_CONCURRENT', 5)
const batchSize = config('BATCH_SIZE', 10)
const minTime = config('MIN_TIME', 200)
const accessCookie = config('ACCESS_COOKIE')

/**/

function chunk(arr, len) {
  let chunks = [],
      i = 0,
      n = arr.length;

  while (i < n) {
    chunks.push(arr.slice(i, i += len));
  }

  return chunks;
}

function connect({host, dbname, username, password, port}){
  return mysql.createConnection(`mysql://${username}:${password}@${host}:${port}/${dbname}`)
}

async function cleanApps(db, limiter) {
  console.info(`Cleaning Apps`)
  const [rows] = await db.query('select app_id from application WHERE is_active = 0 ORDER BY app_id DESC;')
  const appIds = rows.map((r) => r["app_id"])
  const appIdsBatches = chunk(appIds, batchSize)
  console.info(`# app_ids: ${appIds.length} in ${appIdsBatches.length} batches of ${batchSize}`)

  const options = {
    url: `${siberianRoot}/clean/admin/delete-application.php`,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'cookie': accessCookie,
    }
  }

  return Promise.all(appIdsBatches.map((appIds, index) => limiter.schedule(() => {
    console.info(`processing batch #${index}: ${JSON.stringify(appIds)}`)
    return request.post({
      ...options,
      body: `deleteBtn=&datatable-buttons_length=${batchSize}&${appIds.map((id) => `recordsCheckBox%5B%5D=${id}`).join("&")}` 
    },
    (err, httpResponse) => {
      if (err) {
        console.warn(err)
      } else {
        console.info(`httpResponse status: ${httpResponse.statusCode} for batch ${index}`)
      }
    })
  })))
}

;(async () => {
  const db = await connect(dbconfig)

  const limiter = new Bottleneck({
    maxConcurrent,
    minTime
  })

  try {
    await cleanApps(db, limiter)
  } catch(e) {
    console.error(e)
  }

  db.end()
})()