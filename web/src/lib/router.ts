import { useEffect, useState } from 'react'

export type RouteName = 'drops' | 'drop' | 'status' | 'verify' | 'tickets' | 'dashboard' | 'account'
export interface Route { name: RouteName; id?: string }

const withId: RouteName[] = ['drop', 'verify', 'dashboard']
const plain: RouteName[] = ['status', 'verify', 'tickets', 'dashboard', 'account']

function parse(): Route {
  const [a, b] = location.hash.replace(/^#\/?/, '').split('/')
  const id = b ? decodeURIComponent(b) : undefined
  if (id && (withId as string[]).includes(a)) return { name: a as RouteName, id }
  if ((plain as string[]).includes(a)) return { name: a as RouteName }
  return { name: 'drops' }
}

// Hash routes work on any static host with no rewrite rules.
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse)
  useEffect(() => {
    const on = () => { setRoute(parse()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export const href = (name: RouteName, id?: string) =>
  name === 'drops' ? '#/' : id ? `#/${name}/${encodeURIComponent(id)}` : `#/${name}`
export const go = (name: RouteName, id?: string) => { location.hash = href(name, id) }
