import { parse as parseDomain } from 'tldts';

const TRACKING_KEYS = new Set([
    'dclid',
    'fbclid',
    'gclid',
    'igshid',
    'mc_cid',
    'mc_eid',
    'msclkid',
]);

export type CandidateSource = 'canonical' | 'page';

export interface ArticleCandidate {
    url: string;
    identity: string;
    source: CandidateSource;
}

function isNonPublicIpv4(hostname: string): boolean {
    const octets = hostname.split('.').map(Number);
    if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
        return false;
    }

    const [first, second, third] = octets;
    if (first === undefined || second === undefined || third === undefined) {
        return false;
    }

    return first === 0
        || first === 10
        || (first === 100 && second >= 64 && second <= 127)
        || first === 127
        || (first === 169 && second === 254)
        || (first === 172 && second >= 16 && second <= 31)
        || (first === 192 && second === 0 && (third === 0 || third === 2))
        || (first === 192 && second === 88 && third === 99)
        || (first === 192 && second === 168)
        || (first === 198 && (second === 18 || second === 19))
        || (first === 198 && second === 51 && third === 100)
        || (first === 203 && second === 0 && third === 113)
        || first >= 224;
}

function parseIpv6(hostname: string): number[] | null {
    if (!hostname.startsWith('[') || !hostname.endsWith(']')) {
        return null;
    }

    const address = hostname.slice(1, -1);
    const compressed = address.split('::');
    if (compressed.length > 2) {
        return null;
    }
    const left = compressed[0] === '' ? [] : (compressed[0] ?? '').split(':');
    const right = compressed.length === 1 || compressed[1] === '' ? [] : (compressed[1] ?? '').split(':');
    const omitted = 8 - left.length - right.length;
    if ((compressed.length === 1 && omitted !== 0) || (compressed.length === 2 && omitted < 1)) {
        return null;
    }

    const words = [
        ...left,
        ...Array.from({ length: omitted }, () => '0'),
        ...right,
    ].map((word) => Number.parseInt(word, 16));
    return words.length === 8 && words.every((word) => Number.isInteger(word) && word >= 0 && word <= 0xffff)
        ? words
        : null;
}

function embeddedIpv4(high: number, low: number): string {
    return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

function mappedIpv4(words: number[]): string | null {
    if (!words.slice(0, 5).every((word) => word === 0) || words[5] !== 0xffff) {
        return null;
    }
    const high = words[6];
    const low = words[7];
    if (high === undefined || low === undefined) {
        return null;
    }
    return embeddedIpv4(high, low);
}

function sixToFourIpv4(words: number[]): string | null {
    const high = words[1];
    const low = words[2];
    if (words[0] !== 0x2002 || high === undefined || low === undefined) {
        return null;
    }
    return embeddedIpv4(high, low);
}

function isPublicIpv6(hostname: string): boolean {
    const words = parseIpv6(hostname);
    if (words === null) {
        return false;
    }

    const mapped = mappedIpv4(words);
    if (mapped !== null) {
        return !isNonPublicIpv4(mapped);
    }
    const sixToFour = sixToFourIpv4(words);
    if (sixToFour !== null && isNonPublicIpv4(sixToFour)) {
        return false;
    }

    const first = words[0];
    const second = words[1];
    if (first === undefined || second === undefined || first < 0x2000 || first > 0x3fff) {
        return false;
    }

    // IETF protocol assignments, benchmarking, and other special-purpose space.
    if (first === 0x2001 && second <= 0x01ff) {
        return false;
    }
    // Documentation prefixes are not globally routable.
    return !(first === 0x2001 && second === 0x0db8)
        && !(first === 0x3fff && second <= 0x0fff);
}

function isNonPublicHostname(hostname: string): boolean {
    const normalized = hostname.toLowerCase().replace(/\.+$/, '');
    const ipv4Parts = normalized.split('.');
    const isIpv4 = ipv4Parts.length === 4
        && ipv4Parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
    if (isIpv4) {
        return isNonPublicIpv4(normalized);
    }
    if (normalized.startsWith('[')) {
        return !isPublicIpv6(normalized);
    }
    if (!normalized.includes('.')
        || normalized === 'localhost'
        || normalized.endsWith('.localhost')
        || normalized.endsWith('.local')
        || normalized.endsWith('.internal')) {
        return true;
    }
    return parseDomain(normalized, { allowPrivateDomains: false }).isIcann !== true;
}

function parseEligibleUrl(value: string, base?: string): URL | null {
    try {
        const url = base === undefined ? new URL(value) : new URL(value, base);
        if (!['http:', 'https:'].includes(url.protocol)
            || url.username !== ''
            || url.password !== ''
            || isNonPublicHostname(url.hostname)) {
            return null;
        }
        return url;
    } catch {
        return null;
    }
}

function sanitizeParsedUrl(value: URL): URL {
    const url = new URL(value.href);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/\.+$/, '');
    for (const key of [...url.searchParams.keys()]) {
        const normalizedKey = key.toLowerCase();
        if (normalizedKey.startsWith('utm_') || TRACKING_KEYS.has(normalizedKey)) {
            url.searchParams.delete(key);
        }
    }
    return url;
}

export function sanitizeArticleUrl(value: string, base?: string): string | null {
    const url = parseEligibleUrl(value, base);
    return url === null ? null : sanitizeParsedUrl(url).href;
}

export function normalizeArticleUrl(value: string): string | null {
    const parsed = parseEligibleUrl(value);
    if (parsed === null) {
        return null;
    }
    const url = sanitizeParsedUrl(parsed);

    const pathname = url.pathname !== '/' && url.pathname.endsWith('/')
        ? url.pathname.slice(0, -1)
        : url.pathname === '/' ? '' : url.pathname;
    const port = url.port === '' ? '' : `:${url.port}`;
    const hostname = url.hostname.toLowerCase().replace(/\.+$/, '');

    return `${hostname}${port}${pathname}${url.search}`;
}

export function buildArticleCandidates(pageUrl: string, canonicalHref?: string | null): ArticleCandidate[] {
    const rawCandidates: Array<{ source: CandidateSource; url: URL | null }> = [];
    if (canonicalHref !== undefined && canonicalHref !== null && canonicalHref.trim() !== '') {
        rawCandidates.push({
            source: 'canonical',
            url: parseEligibleUrl(canonicalHref, pageUrl),
        });
    }
    rawCandidates.push({
        source: 'page',
        url: parseEligibleUrl(pageUrl),
    });

    const seen = new Set<string>();
    const candidates: ArticleCandidate[] = [];
    for (const candidate of rawCandidates) {
        if (candidate.url === null) {
            continue;
        }
        const sanitizedUrl = sanitizeParsedUrl(candidate.url);
        const url = sanitizedUrl.href;
        const identity = normalizeArticleUrl(url);
        if (identity === null || seen.has(identity)) {
            continue;
        }
        seen.add(identity);
        candidates.push({
            url,
            identity,
            source: candidate.source,
        });
    }
    return candidates;
}
