import { Frame, Page } from 'puppeteer-core'
import { VBrowser } from '..'
import { extractOrFetchCSS, optimizeCSS } from '../utils/css'
import { ClipRequest } from './VBrowser'
import { VDocument } from './VDocument'
import { VJsdom } from './VJsdom'
import { VPage } from './VPage'

export class VFrame {
    isRoot = false

    constructor(public vBrowser: VBrowser, public frame: Frame | Page) {}

    async _clip({ onlyIndex = false, element, click, scroll, maxScrolls = 10 }: ClipRequest = {}) {
        const originalDocument = await VDocument.create(this, () => document)

        const height = await originalDocument.scrollToBottom({ element, scroll, maxScrolls })

        if (this instanceof VPage) {
            await this.setViewportHeight(height)
            await this.frame.waitFor(3000)
        }

        if (click) {
            await originalDocument.click(click)
        }

        if (!onlyIndex) {
            await originalDocument.setUuidToIFramesAndShadowHosts()
            await originalDocument.replaceObjectURLsWithDataURL()
            await originalDocument.embedContentOfShadowDOMs()
        }

        const { html: originalHTML, location } = await originalDocument.getHTML()
        const sheetDataList = await originalDocument.getSheetDataList()

        const dom = new VJsdom(originalHTML, { url: location.href })

        if (element) {
            dom.setElementAsRoot(element)
        }
        dom.execPlugins()

        if (onlyIndex) {
            return dom.generate()
        }

        const m = location.href.match(/https:\/\/mobile\.twitter\.com\/.+\/status\/(\d+)/)
        if (m) {
            await dom.embedTwitterVideo(m[1])
        }

        await Promise.all([
            (async () => {
                const iframes = dom.getIframes()
                const iframeDataList = await originalDocument.clipIframes(iframes)

                dom.embedIFrameContents(iframeDataList)
            })(),

            (async () => {
                await dom.processResourcesInAttrs()

                const sheets = await extractOrFetchCSS(sheetDataList)
                const optimized = await Promise.all(
                    sheets.map(sheet => optimizeCSS(sheet, dom.document)),
                )

                dom.appendStyleSheets(optimized)
                dom.appendScriptToHead()
            })(),
        ])

        if (this instanceof VPage) {
            await this.resetViewport()
        }

        return dom.generate()
    }
}
