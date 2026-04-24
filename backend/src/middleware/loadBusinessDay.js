import { BusinessDay } from '../models/BusinessDay.js'
import { todayBusinessDate } from '../utils/date.js'

/** Attaches today's BusinessDay document to req.businessDay (may be null). */
export async function loadBusinessDay(req, _res, next) {
  try {
    const businessDate = todayBusinessDate()
    let doc = await BusinessDay.findOne({ businessDate })
    if (!doc) {
      doc = await BusinessDay.create({ businessDate, active: false })
    }
    req.businessDay = doc
    req.businessDate = businessDate
    next()
  } catch (e) {
    next(e)
  }
}
