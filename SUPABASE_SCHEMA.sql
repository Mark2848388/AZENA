-- Azena Cloud schema. Run in Supabase SQL editor.
-- Client-side code must use only the publishable key. Never use service_role in browser.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text, email text,
  role text not null default 'student' check(role in ('teacher','student')),
  bio text, avatar_url text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists public.classes (
  id text primary key, name text not null, code text unique not null,
  teacher_id uuid not null references auth.users(id) on delete cascade,
  teacher_name text, data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);
create table if not exists public.class_members (
  class_id text references public.classes(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  joined_at timestamptz default now(), primary key(class_id,user_id)
);
create table if not exists public.homework_submissions (
  id uuid primary key default gen_random_uuid(), class_id text references public.classes(id) on delete cascade,
  lesson_id text not null, student_id uuid references auth.users(id) on delete cascade,
  submission jsonb not null default '{}'::jsonb, submitted_at timestamptz default now(),
  reviewed_by uuid references auth.users(id), reviewed_at timestamptz, feedback text, score numeric,
  unique(lesson_id,student_id)
);
create table if not exists public.vocabulary (
  id uuid primary key default gen_random_uuid(), class_id text references public.classes(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade, word text not null, translation text,
  created_at timestamptz default now()
);
create table if not exists public.call_history (
  id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade,
  room_code text, note text, started_at timestamptz default now()
);
create table if not exists public.lesson_progress (
  class_id text references public.classes(id) on delete cascade, lesson_id text not null,
  user_id uuid references auth.users(id) on delete cascade, completed_at timestamptz default now(),
  primary key(class_id,lesson_id,user_id)
);

alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.class_members enable row level security;
alter table public.homework_submissions enable row level security;
alter table public.vocabulary enable row level security;
alter table public.call_history enable row level security;
alter table public.lesson_progress enable row level security;

drop policy if exists profile_self on public.profiles;
create policy profile_self on public.profiles for all to authenticated using(id=auth.uid()) with check(id=auth.uid());
drop policy if exists classes_read_member on public.classes;
create policy classes_read_member on public.classes for select to authenticated using(teacher_id=auth.uid() or exists(select 1 from public.class_members m where m.class_id=classes.id and m.user_id=auth.uid()));
drop policy if exists classes_teacher_write on public.classes;
create policy classes_teacher_write on public.classes for all to authenticated using(teacher_id=auth.uid()) with check(teacher_id=auth.uid());
drop policy if exists members_read on public.class_members;
create policy members_read on public.class_members for select to authenticated using(user_id=auth.uid());
drop policy if exists members_teacher_insert on public.class_members;
create policy members_teacher_insert on public.class_members for insert to authenticated with check(exists(select 1 from public.classes c where c.id=class_members.class_id and c.teacher_id=auth.uid()));
drop policy if exists hw_student_select on public.homework_submissions;
create policy hw_student_select on public.homework_submissions for select to authenticated using(student_id=auth.uid() or exists(select 1 from public.classes c where c.id=homework_submissions.class_id and c.teacher_id=auth.uid()));
drop policy if exists hw_student_insert on public.homework_submissions;
create policy hw_student_insert on public.homework_submissions for insert to authenticated with check(student_id=auth.uid() and exists(select 1 from public.class_members m where m.class_id=homework_submissions.class_id and m.user_id=auth.uid()));
drop policy if exists hw_teacher_review on public.homework_submissions;
create policy hw_teacher_review on public.homework_submissions for update to authenticated using(exists(select 1 from public.classes c where c.id=homework_submissions.class_id and c.teacher_id=auth.uid())) with check(exists(select 1 from public.classes c where c.id=homework_submissions.class_id and c.teacher_id=auth.uid()));
drop policy if exists vocab_self on public.vocabulary;
create policy vocab_self on public.vocabulary for all to authenticated using(user_id=auth.uid() or exists(select 1 from public.classes c where c.id=vocabulary.class_id and c.teacher_id=auth.uid())) with check(user_id=auth.uid());
drop policy if exists calls_self on public.call_history;
create policy calls_self on public.call_history for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
drop policy if exists progress_self_or_teacher on public.lesson_progress;
create policy progress_self_or_teacher on public.lesson_progress for select to authenticated using(user_id=auth.uid() or exists(select 1 from public.classes c where c.id=lesson_progress.class_id and c.teacher_id=auth.uid()));
drop policy if exists progress_insert_self on public.lesson_progress;
create policy progress_insert_self on public.lesson_progress for insert to authenticated with check(user_id=auth.uid() and exists(select 1 from public.class_members m where m.class_id=lesson_progress.class_id and m.user_id=auth.uid()));

-- Students join using the code. Function checks auth.uid(), returns class payload.
create or replace function public.join_class_by_code(class_code text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare found_class public.classes;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into found_class from public.classes where code=class_code;
  if found_class.id is null then raise exception 'Class code not found'; end if;
  insert into public.class_members(class_id,user_id) values(found_class.id,auth.uid()) on conflict do nothing;
  return found_class.data;
end; $$;
revoke all on function public.join_class_by_code(text) from public;
grant execute on function public.join_class_by_code(text) to authenticated;
grant select,insert,update,delete on public.profiles,public.classes,public.class_members,public.homework_submissions,public.vocabulary,public.call_history,public.lesson_progress to authenticated;
