#!/usr/bin/env python3
"""
Crawler runner script bridging Node.js and Crawl4AI.
Outputs structured JSON to stdout for single-page and multi-page ingestion.
"""

import sys
import json
import argparse
import asyncio

def parse_args():
    parser = argparse.ArgumentParser(description="Run Crawl4AI on a given URL")
    parser.add_argument("--url", required=True, help="Target URL to crawl")
    parser.add_argument("--deep", action="store_true", help="Enable multi-page BFS deep crawl")
    parser.add_argument("--max-pages", type=int, default=10, help="Maximum pages to crawl")
    parser.add_argument("--max-depth", type=int, default=2, help="Maximum BFS crawl depth")
    return parser.parse_args()

def extract_markdown_and_title(crawl_result, fallback_url):
    title = ""
    if hasattr(crawl_result, "metadata") and isinstance(crawl_result.metadata, dict):
        title = crawl_result.metadata.get("title", "")
    if not title and hasattr(crawl_result, "title"):
        title = crawl_result.title or ""

    markdown = ""
    if hasattr(crawl_result, "markdown") and crawl_result.markdown:
        if hasattr(crawl_result.markdown, "raw_markdown"):
            markdown = crawl_result.markdown.raw_markdown
        else:
            markdown = str(crawl_result.markdown)
    elif hasattr(crawl_result, "cleaned_html"):
        markdown = crawl_result.cleaned_html or ""

    result_url = getattr(crawl_result, "url", fallback_url) or fallback_url

    return {
        "url": result_url,
        "title": title.strip() if title else result_url,
        "markdown": markdown.strip(),
    }

async def run_crawler(args):
    try:
        from crawl4ai import AsyncWebCrawler, CrawlerRunConfig, BrowserConfig
    except ImportError as e:
        return {
            "success": False,
            "error": f"crawl4ai is not installed in the Python environment: {str(e)}"
        }

    browser_config = BrowserConfig(headless=True, verbose=False)

    try:
        if args.deep:
            from crawl4ai.deep_crawling import BFSDeepCrawlStrategy

            strategy = BFSDeepCrawlStrategy(
                max_depth=args.max_depth,
                max_pages=args.max_pages,
            )
            run_config = CrawlerRunConfig(
                deep_crawl_strategy=strategy,
                check_robots_txt=True,
                verbose=False,
            )

            async with AsyncWebCrawler(config=browser_config) as crawler:
                results = await crawler.arun(url=args.url, config=run_config)

                pages = []
                items = results if isinstance(results, list) else [results]
                for r in items:
                    if getattr(r, "success", True):
                        page_data = extract_markdown_and_title(r, args.url)
                        if page_data["markdown"]:
                            pages.append(page_data)

                if not pages:
                    return {
                        "success": False,
                        "error": "No pages or content could be extracted from the target website",
                    }

                return {
                    "success": True,
                    "pages": pages,
                }
        else:
            run_config = CrawlerRunConfig(
                check_robots_txt=True,
                verbose=False,
            )

            async with AsyncWebCrawler(config=browser_config) as crawler:
                result = await crawler.arun(url=args.url, config=run_config)

                if not getattr(result, "success", True):
                    return {
                        "success": False,
                        "error": getattr(result, "error_message", None) or "Failed to crawl webpage",
                    }

                page_data = extract_markdown_and_title(result, args.url)
                if not page_data["markdown"]:
                    return {
                        "success": False,
                        "error": "Webpage returned empty or non-extractable content",
                    }

                return {
                    "success": True,
                    "pages": [page_data],
                }

    except Exception as exc:
        return {
            "success": False,
            "error": f"Crawl execution failed: {str(exc)}",
        }

def main():
    args = parse_args()
    try:
        result = asyncio.run(run_crawler(args))
        print(json.dumps(result))
    except Exception as err:
        print(json.dumps({"success": False, "error": str(err)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
