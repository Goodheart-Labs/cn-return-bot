-- Filters that exclude (GOO-823). A filter of the review page or of the
-- notewriter pages can now be negated, for example "Specific creators: not
-- Astral Codex Ten". The browser marks such a filter with `not: true`, and this
-- function then keeps exactly the rows the filter would have left out.
--
-- A plain condition is null on a row whose field has no value, and such a row
-- fails the filter. The negation must keep that row, because "not Astral Codex
-- Ten" should still show the notes without a creator. So the condition is read
-- as false when it is null before it is negated.
--
-- Only this function changes. Its signature stays the same, so the grants of
-- migration 159 stay as they are.
create or replace function field_query_condition(p_row regclass, p_filters jsonb, p_skip_column text default null) returns text
language plpgsql stable set search_path = public as $$
declare
  f jsonb;
  v_number text;
  v_picked text[];
  v_parts text[] := array['true'];
begin
  for f in select t.value from jsonb_array_elements(coalesce(p_filters, '[]'::jsonb)) t loop
    continue when f ->> 'column' = p_skip_column;
    v_picked := array['true'];
    if f ? 'in' then
      v_picked := v_picked || format('%s = any (%L::text[])', field_query_text(p_row, f ->> 'column'), array(select jsonb_array_elements_text(f -> 'in')));
    else
      v_number := field_query_number(p_row, f ->> 'column');
      if v_number is null then raise exception 'Field % is not a number', f ->> 'column'; end if;
      if f ? 'min' then v_picked := v_picked || format('%s >= %s', v_number, (f ->> 'min')::float8); end if;
      if f ? 'max' then v_picked := v_picked || format('%s <= %s', v_number, (f ->> 'max')::float8); end if;
    end if;
    if coalesce((f ->> 'not')::boolean, false) then
      v_parts := v_parts || format('not coalesce(%s, false)', array_to_string(v_picked, ' and '));
    else
      v_parts := v_parts || v_picked[2:];
    end if;
  end loop;
  return array_to_string(v_parts, ' and ');
end;
$$;
