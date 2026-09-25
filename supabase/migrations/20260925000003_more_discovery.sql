-- More discovery sources: podcasts and books, so "Suggested" covers all three kinds.
-- Podcast feed URLs come from the Apple Podcasts directory. We use episode titles and show notes only.
-- Books have no feed: the worker uses them as themes and references, never book text.
-- Review this list before launch (quality, licensing, balance of views).

-- Podcasts. If a user already added the same feed, that catalog row becomes a discovery source.
insert into sources (kind, title, url, feed_url, is_discovery, discovery_categories) values
  ('podcast', 'Hard Fork', 'https://podcasts.apple.com/us/podcast/id1528594034', 'https://feeds.simplecast.com/6HKOhNgS', true, '{ai}'),
  ('podcast', 'Latent Space', 'https://podcasts.apple.com/us/podcast/id1674008350', 'https://api.substack.com/feed/podcast/1084089.rss', true, '{ai}'),
  ('podcast', 'Decoder with Nilay Patel', 'https://podcasts.apple.com/us/podcast/id1011668648', 'https://feeds.megaphone.fm/recodedecode', true, '{ai,strategy}'),
  ('podcast', 'HBR IdeaCast', 'https://podcasts.apple.com/us/podcast/id152022135', 'http://feeds.harvardbusiness.org/harvardbusiness/ideacast', true, '{leadership,strategy}'),
  ('podcast', 'The Knowledge Project', 'https://podcasts.apple.com/us/podcast/id990149481', 'https://feeds.megaphone.fm/FSMI7575968096', true, '{leadership,careers}'),
  ('podcast', 'Acquired', 'https://podcasts.apple.com/us/podcast/id1050462261', 'https://feeds.transistor.fm/acquired', true, '{strategy,startups}'),
  ('podcast', 'Odd Lots', 'https://podcasts.apple.com/us/podcast/id1056200096', 'https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/8a94442e-5a74-4fa2-8b8d-ae27003a8d6b/982f5071-765c-403d-969d-ae27003a8d83/podcast.rss', true, '{markets}'),
  ('podcast', 'Planet Money', 'https://podcasts.apple.com/us/podcast/id290783428', 'https://feeds.npr.org/510289/podcast.xml', true, '{markets}'),
  ('podcast', 'Lenny''s Podcast', 'https://podcasts.apple.com/us/podcast/id1627920305', 'https://api.substack.com/feed/podcast/10845.rss', true, '{product,careers}'),
  ('podcast', '20VC', 'https://podcasts.apple.com/us/podcast/id958230465', 'https://rss.libsyn.com/shows/61840/destinations/240976.xml', true, '{startups}'),
  ('podcast', 'How I Built This', 'https://podcasts.apple.com/us/podcast/id1150510297', 'https://rss.art19.com/how-i-built-this', true, '{startups}'),
  ('podcast', 'The Skift Travel Podcast', 'https://podcasts.apple.com/us/podcast/id999975096', 'https://feeds.megaphone.fm/SKIFT8999081027', true, '{travel}'),
  ('podcast', 'In Phocus (PhocusWire)', 'https://podcasts.apple.com/us/podcast/id1727229211', 'https://www.omnycontent.com/d/playlist/37ffe223-859b-4955-b6ca-aab8005d8b43/879749c5-2eb8-4629-a791-ae8700ce6ce8/95b45464-58cb-4896-b3c5-b1000134803a/podcast.rss', true, '{travel}'),
  ('podcast', 'GZERO World with Ian Bremmer', 'https://podcasts.apple.com/us/podcast/id1294461271', 'https://feeds.simplecast.com/ibBxsiVV', true, '{geopolitics}'),
  ('podcast', 'The Rest Is Politics', 'https://podcasts.apple.com/us/podcast/id1611374685', 'https://feeds.megaphone.fm/GLT9190936013', true, '{geopolitics}'),
  ('podcast', 'Radiolab', 'https://podcasts.apple.com/us/podcast/id152249110', 'https://feeds.simplecast.com/EmVW7VGp', true, '{science}'),
  ('podcast', 'Hidden Brain', 'https://podcasts.apple.com/us/podcast/id1028908750', 'https://feeds.simplecast.com/kwWc0lhf', true, '{science,careers}'),
  ('podcast', 'Huberman Lab', 'https://podcasts.apple.com/us/podcast/id1545953110', 'https://feeds.megaphone.fm/hubermanlab', true, '{health,science}'),
  ('podcast', 'The Peter Attia Drive', 'https://podcasts.apple.com/us/podcast/id1400828889', 'https://rss.libsyn.com/shows/121729/destinations/713489.xml', true, '{health}'),
  ('podcast', 'Catalyst with Shayle Kann', 'https://podcasts.apple.com/us/podcast/id1593204897', 'https://feeds.megaphone.fm/catalyst', true, '{climate}'),
  ('podcast', 'Volts', 'https://podcasts.apple.com/us/podcast/id1548554104', 'https://api.substack.com/feed/podcast/193024.rss', true, '{climate}')
on conflict (feed_url) where feed_url is not null and owner_user_id is null
do update set is_discovery = true, discovery_categories = excluded.discovery_categories;

-- Books: public catalog rows (no owner), so everyone can follow the same one.
insert into sources (kind, title, is_discovery, discovery_categories)
select 'book', v.title, true, v.categories
from (values
  ('Co-Intelligence — Ethan Mollick', '{ai}'::text[]),
  ('The Coming Wave — Mustafa Suleyman', '{ai,geopolitics}'),
  ('Multipliers — Liz Wiseman', '{leadership}'),
  ('High Output Management — Andrew Grove', '{leadership}'),
  ('Turn the Ship Around! — L. David Marquet', '{leadership}'),
  ('Good Strategy Bad Strategy — Richard Rumelt', '{strategy}'),
  ('7 Powers — Hamilton Helmer', '{strategy}'),
  ('The Psychology of Money — Morgan Housel', '{markets}'),
  ('Inspired — Marty Cagan', '{product}'),
  ('The Mom Test — Rob Fitzpatrick', '{product,startups}'),
  ('Zero to One — Peter Thiel', '{startups}'),
  ('The Hard Thing About Hard Things — Ben Horowitz', '{startups,leadership}'),
  ('The Airbnb Story — Leigh Gallagher', '{travel}'),
  ('Overbooked: The Exploding Business of Travel and Tourism — Elizabeth Becker', '{travel}'),
  ('Prisoners of Geography — Tim Marshall', '{geopolitics}'),
  ('Chip War — Chris Miller', '{geopolitics,ai}'),
  ('Thinking, Fast and Slow — Daniel Kahneman', '{science,careers}'),
  ('Outlive — Peter Attia', '{health}'),
  ('Why We Sleep — Matthew Walker', '{health,science}'),
  ('Range — David Epstein', '{careers}'),
  ('Mindset — Carol Dweck', '{careers}'),
  ('How to Avoid a Climate Disaster — Bill Gates', '{climate}')
) as v (title, categories)
where not exists (
  select 1 from sources s where s.kind = 'book' and s.owner_user_id is null and s.title = v.title
);
