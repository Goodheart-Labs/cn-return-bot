-- Pin Zvi's Substack to the top of the project list. Enqueue-created projects
-- default to sort_order 0, so a negative value keeps Zvi first even as new
-- projects appear; commonnotes.net opens on the first project with notes.

update everything_projects set sort_order = -1 where slug = 'zvi';
