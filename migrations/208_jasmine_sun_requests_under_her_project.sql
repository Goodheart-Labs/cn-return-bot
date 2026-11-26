-- Migration 208: file Jasmine Sun's five requested posts under her project.
--
-- On 2026-11-26 at 12:52 UTC Jim asked for checks of five of Jasmine Sun's
-- posts, two hours after her creator was given priority. The extension sent a
-- request's creator only while the creator could still be pressed, so during
-- her priority window each request went out without one. The intake service
-- then filed all five under Around the web instead of under her project. The
-- extension fix ships in the same pull request.
--
-- Two of the five were requested from Substack's reader app, and the popup sent
-- the reader's address instead of the post's own. Readers open those posts on
-- jasmi.news, so the extension never found their items, and the seven notes on
-- "No data centers in my backyard" never showed on the post. Those two items
-- get the post's own address here. No other item has either address.

update everything_items
set url = 'https://jasmi.news/p/no-data-centers-in-my-backyard'
where id = '578973d6-0807-457e-92c5-ef66bb370c8f'
  and url = 'https://substack.com/@jasmine/p-209624138';

update everything_items
set url = 'https://jasmi.news/p/2026-advice'
where id = '9d67b1a2-69ee-4c16-94a9-fc91bf4710ac'
  and url = 'https://substack.com/@jasmine/p-201360109';

update everything_items
set project_id = (select id from everything_projects where feed_url = 'https://jasmine.substack.com')
where id in (
  '578973d6-0807-457e-92c5-ef66bb370c8f',
  '9d67b1a2-69ee-4c16-94a9-fc91bf4710ac',
  '34bfe63c-db48-4cef-8acc-48cecb492fa7',
  '5173a22f-562b-4ca4-884d-bf8529c8666b',
  '94ba92dc-f83d-4c00-8bab-ec1e01dd2c92'
)
  and project_id = (select id from everything_projects where slug = 'web');
