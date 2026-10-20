import { describe, expect, it } from 'bun:test'
import { UPLOAD_PART, remoteApiAllowed, remoteApiError, remoteUploadAllowed, sitePath, uploadParts } from './remoteUiRules'

describe('remote ui bridge', () => {
  it('lets website screens reach only their API sections', () => {
    expect(remoteApiAllowed('/hosting/servers/me', 'GET')).toBe(true)
    expect(remoteApiAllowed('/hosting/servers/1/start', 'POST')).toBe(true)
    expect(remoteApiAllowed('/me/money', 'GET')).toBe(false)
    expect(remoteApiAllowed('/rubies/buy', 'POST')).toBe(false)
    expect(remoteApiAllowed('/hosting/../me', 'GET')).toBe(false)
    expect(remoteApiAllowed('/hosting/servers/me', 'TRACE')).toBe(false)
  })

  it('lets the catalog screen search Modrinth and CurseForge and post reviews, nothing more', () => {
    expect(remoteApiAllowed('/launcher/mr/v2/search?limit=20&query=jei', 'GET')).toBe(true)
    expect(remoteApiAllowed('/launcher/cf/v1/mods/search?gameId=432&searchFilter=jei', 'GET')).toBe(true)
    expect(remoteApiAllowed('/launcher/mr/v2/search?limit=20', 'POST')).toBe(false)
    expect(remoteApiAllowed('/launcher/premium/x/buy', 'POST')).toBe(true)
    expect(remoteApiAllowed('/launcher/premium/subscribe', 'POST')).toBe(true)
    expect(remoteApiAllowed('/launcher/premium/arcania', 'GET')).toBe(true)
    expect(remoteApiAllowed('/launcher/premium/arcania', 'DELETE')).toBe(false)
    expect(remoteApiAllowed('/launcher/premium/x/buy', 'GET')).toBe(false)
    expect(remoteApiAllowed('/launcher/account', 'GET')).toBe(false)
    expect(remoteApiAllowed('/forum/articles/sodium/reviews', 'GET')).toBe(true)
    expect(remoteApiAllowed('/forum/articles/sodium/review', 'POST')).toBe(true)
    expect(remoteApiAllowed('/forum/articles/9b1c-uuid/like', 'POST')).toBe(true)
    expect(remoteApiAllowed('/forum/articles/sodium', 'GET')).toBe(true)
    expect(remoteApiAllowed('/forum/articles/sodium', 'DELETE')).toBe(false)
    expect(remoteApiAllowed('/forum/articles', 'POST')).toBe(false)
  })

  it('reads the status and body out of a launcher API error', () => {
    const e = remoteApiError(new Error('http 402: {"message":"Не хватает","code":"NO_MONEY"}'))
    expect(e.status).toBe(402)
    expect((e.body as { code: string }).code).toBe('NO_MONEY')
    expect(e.message).toBe('Не хватает')
  })

  it('opens only site-relative paths on millida.net', () => {
    expect(sitePath('/hosting/new')).toBe('https://millida.net/hosting/new')
    expect(sitePath('//evil.example')).toBe(null)
    expect(sitePath('https://evil.example')).toBe(null)
  })
})

describe('remote ui raw uploads', () => {
  it('opens only the two hosting upload routes with their methods', () => {
    expect(remoteUploadAllowed('/hosting/servers/s-1/files/upload?path=%2Fa.zip&offset=0', 'POST')).toBe(true)
    expect(remoteUploadAllowed('/hosting/servers/s-1/resource-pack?name=a.zip', 'PUT')).toBe(true)
    expect(remoteUploadAllowed('/hosting/servers/s-1/files/upload', 'PUT')).toBe(false)
    expect(remoteUploadAllowed('/hosting/servers/s-1/files/delete', 'POST')).toBe(false)
    expect(remoteUploadAllowed('/hosting/servers/../files/upload', 'POST')).toBe(false)
    expect(remoteUploadAllowed('/me/avatar', 'POST')).toBe(false)
  })

  it('cuts a big file-manager chunk into pieces with shifted offsets', () => {
    const path = '/hosting/servers/s-1/files/upload?path=%2Fw.zip&offset=100&total=999'
    const size = UPLOAD_PART * 2 + 5
    const parts = uploadParts(path, 'POST', size)
    expect(parts.length).toBe(3)
    expect(parts[0].path).toContain('offset=100&total=999')
    expect(parts[1].path).toContain(`offset=${100 + UPLOAD_PART}&total=999`)
    expect(parts[2].end).toBe(size)
    expect(uploadParts(path, 'POST', 10)).toEqual([{ path, start: 0, end: 10 }])
    expect(uploadParts('/hosting/servers/s-1/resource-pack?name=a', 'PUT', size).length).toBe(1)
  })
})
