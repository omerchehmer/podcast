-- Reference data: topic categories, voices, and a starter list of discovery sources.
-- Discovery sources fill the gap when a new user has added few sources of their own.
-- Only feeds that publish public summaries. We link to the originals and never copy full articles.

insert into topic_categories (id, name, sort) values
  ('ai', 'AI and technology', 1),
  ('leadership', 'Leadership and management', 2),
  ('strategy', 'Strategy', 3),
  ('markets', 'Markets and economy', 4),
  ('product', 'Product and design', 5),
  ('startups', 'Startups and venture', 6),
  ('travel', 'Travel industry', 7),
  ('geopolitics', 'Geopolitics', 8),
  ('science', 'Science', 9),
  ('health', 'Health and performance', 10),
  ('careers', 'Careers and learning', 11),
  ('climate', 'Climate and energy', 12)
on conflict (id) do nothing;

insert into voices (id, provider, provider_voice_id, name, description, preview_path, words_per_minute) values
  ('marin', 'openai', 'marin', 'Marin', 'Warm and clear', 'voices/marin.mp3', 160),
  ('cedar', 'openai', 'cedar', 'Cedar', 'Calm and deep', 'voices/cedar.mp3', 155),
  ('coral', 'openai', 'coral', 'Coral', 'Bright and friendly', 'voices/coral.mp3', 165),
  ('sage',  'openai', 'sage',  'Sage',  'Steady and thoughtful', 'voices/sage.mp3', 158),
  ('ash',   'openai', 'ash',   'Ash',   'Direct and confident', 'voices/ash.mp3', 162)
on conflict (id) do nothing;

-- Starter discovery sources. Review this list before launch (quality, licensing, balance of views).
insert into sources (kind, title, url, feed_url, is_discovery, discovery_categories) values
  ('rss', 'Hacker News (front page)', 'https://news.ycombinator.com', 'https://hnrss.org/frontpage', true, '{ai,startups}'),
  ('rss', 'MIT Technology Review', 'https://www.technologyreview.com', 'https://www.technologyreview.com/feed/', true, '{ai,science}'),
  ('rss', 'Harvard Business Review', 'https://hbr.org', 'https://feeds.hbr.org/harvardbusiness', true, '{leadership,strategy}'),
  ('rss', 'Stratechery (free articles)', 'https://stratechery.com', 'https://stratechery.com/feed/', true, '{strategy,ai}'),
  ('rss', 'Skift', 'https://skift.com', 'https://skift.com/feed/', true, '{travel}'),
  ('rss', 'PhocusWire', 'https://www.phocuswire.com', 'https://www.phocuswire.com/rss', true, '{travel}'),
  ('rss', 'BBC News — Business', 'https://www.bbc.co.uk/news/business', 'https://feeds.bbci.co.uk/news/business/rss.xml', true, '{markets}'),
  ('rss', 'BBC News — World', 'https://www.bbc.co.uk/news/world', 'https://feeds.bbci.co.uk/news/world/rss.xml', true, '{geopolitics}'),
  ('rss', 'Lenny''s Newsletter', 'https://www.lennysnewsletter.com', 'https://www.lennysnewsletter.com/feed', true, '{product,careers}'),
  ('rss', 'Carbon Brief', 'https://www.carbonbrief.org', 'https://www.carbonbrief.org/feed/', true, '{climate}')
on conflict do nothing;
