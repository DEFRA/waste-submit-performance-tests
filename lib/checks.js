import { check } from 'k6'

// Every packaging endpoint returns 200 with its results under `items`, which is
// empty when there's nothing for the year. A 404 means the submitter doesn't exist,
// so it counts as a failure here: the test data is wrong.
export function checkItemsResponse(res, name) {
  return check(res, {
    [`${name}: status is 200`]: (r) => r.status === 200,
    [`${name}: items is an array`]: (r) => {
      try {
        return Array.isArray(r.json('items'))
      } catch {
        return false
      }
    }
  })
}
