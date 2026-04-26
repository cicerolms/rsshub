import { load } from 'cheerio';
import type { Context } from 'hono';

import type { DataItem, Language, Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

type ArticleSchema = {
    '@type'?: string;
    headline?: string;
    description?: string;
    datePublished?: string;
    dateModified?: string;
    articleSection?: string;
    image?: string[];
    author?: {
        name?: string;
    };
};

const rootUrl = 'https://hri-vietnam.com';

const languageMap: Record<string, Language> = {
    en: 'en',
    ja: 'ja',
    vi: 'vi',
};

export const route: Route = {
    path: '/articles/:lang?',
    categories: ['blog'],
    example: '/hri-vietnam/articles/en',
    parameters: {
        lang: {
            description: 'Language',
            options: [
                { value: 'en', label: 'English' },
                { value: 'vi', label: 'Tiếng Việt' },
                { value: 'ja', label: '日本語' },
            ],
            default: 'en',
        },
    },
    radar: [
        {
            source: ['hri-vietnam.com/en/article'],
            target: '/articles/en',
        },
        {
            source: ['hri-vietnam.com/vi/article'],
            target: '/articles/vi',
        },
        {
            source: ['hri-vietnam.com/ja/article'],
            target: '/articles/ja',
        },
    ],
    name: 'Articles',
    maintainers: ['nguyen-dinh-phuc'],
    handler,
    url: 'hri-vietnam.com/en/article',
};

async function handler(ctx: Context) {
    const requestedLang = ctx.req.param('lang') || 'en';
    const lang = languageMap[requestedLang] ? requestedLang : 'en';
    const link = `${rootUrl}/${lang}/article`;

    const response = await ofetch(link);
    const $ = load(response);
    const articlePathPattern = new RegExp(`^/${lang}/article/.+/\\d+/[^/]+$`);
    const articleLinks = [
        ...new Set(
            $(`main a[href^="/${lang}/article/"]`)
                .toArray()
                .map((item) => $(item).attr('href'))
                .filter((href): href is string => !!href && articlePathPattern.test(href))
                .map((href) => new URL(href, rootUrl).href)
        ),
    ];

    const items = await Promise.all(articleLinks.map((articleLink) => cache.tryGet(articleLink, () => getArticle(articleLink, lang))));

    return {
        title: $('head title').text() || 'HRI Vietnam Articles',
        description: $('meta[name="description"]').attr('content'),
        link,
        language: languageMap[lang],
        image: new URL('/favicon/favicon.ico', rootUrl).href,
        item: items,
    };
}

async function getArticle(articleLink: string, lang: string): Promise<DataItem> {
    const response = await ofetch(articleLink);
    const $ = load(response);
    const schema = getArticleSchema($);
    const description = $('.article-content').first();

    description.find('img[src]').each((_, element) => {
        const src = $(element).attr('src');
        if (src) {
            $(element).attr('src', new URL(src, rootUrl).href);
        }
    });
    description.find('a[href]').each((_, element) => {
        const href = $(element).attr('href');
        if (href) {
            $(element).attr('href', new URL(href, rootUrl).href);
        }
    });

    const image = schema?.image?.[0] || $('meta[property="og:image"]').attr('content');
    const category = schema?.articleSection ? [schema.articleSection] : undefined;
    const content = description.html() ?? $('meta[name="description"]').attr('content') ?? schema?.description;

    return {
        title: schema?.headline || $('h1').first().text(),
        link: articleLink,
        description: content,
        content: content ? { html: content, text: description.text() || content } : undefined,
        pubDate: schema?.datePublished ? parseDate(schema.datePublished) : undefined,
        updated: schema?.dateModified ? parseDate(schema.dateModified) : undefined,
        author: schema?.author?.name,
        category,
        image,
        language: languageMap[lang],
    };
}

function getArticleSchema($: ReturnType<typeof load>): ArticleSchema | undefined {
    for (const element of $('script[type="application/ld+json"]').toArray()) {
        try {
            const data = JSON.parse($(element).text());
            if (data['@type'] === 'Article') {
                return data;
            }
        } catch {
            continue;
        }
    }
}
