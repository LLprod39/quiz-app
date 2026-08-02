from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .models import AnswerOption, Event, Question, Questionnaire, QuestionnaireItem, Round, uid


def seed_demo(db: Session) -> None:
    if db.scalar(select(Event)):
        return
    event = Event(
        title="Вечер в честь Лены", event_format="celebration", topic="", hero_name="Лена", event_date="2026-08-08", status="draft", is_selected=True,
        theme={"accent": "#ff6b6b", "mode": "dark", "decor": "confetti"}, game_mode="individual",
    )
    event.questionnaire = Questionnaire(items=[
        QuestionnaireItem(text="Какое блюдо вы можете есть снова и снова?", sort_order=0),
        QuestionnaireItem(text="Какое место связано с самым тёплым воспоминанием?", sort_order=1),
        QuestionnaireItem(text="Какую песню друзья сразу связывают с вами?", sort_order=2),
    ])
    first = Round(title="Кто действительно знает Лену", sort_order=0)
    option_ids = [uid() for _ in range(4)]
    first.questions.append(Question(
        text="Какой десерт Лена выберет без раздумий?", type="single", time_limit_seconds=30,
        correct_answer=option_ids[1], explanation="Тирамису — её неизменный заказ уже много лет.", sort_order=0,
        options=[
            AnswerOption(id=option_ids[0], text="Чизкейк", sort_order=0),
            AnswerOption(id=option_ids[1], text="Тирамису", is_correct=True, sort_order=1),
            AnswerOption(id=option_ids[2], text="Медовик", sort_order=2),
            AnswerOption(id=option_ids[3], text="Мороженое", sort_order=3),
        ],
    ))
    first.questions.append(Question(text="В каком году Лена впервые побывала в Италии?", type="number", time_limit_seconds=25, correct_answer=2018, numeric_tolerance=1, explanation="Это была поездка на озеро Комо летом 2018 года.", sort_order=1))
    second = Round(title="Что выберет герой", sort_order=1)
    hero_ids = [uid(), uid()]
    second.questions.append(Question(
        text="Идеальный свободный вечер — дома или в городе?", type="hero_choice", time_limit_seconds=20,
        correct_answer=hero_ids[0], explanation="Сегодня правильный вариант выбирает сама Лена.", sort_order=0,
        options=[AnswerOption(id=hero_ids[0], text="Уютный вечер дома", sort_order=0), AnswerOption(id=hero_ids[1], text="Спонтанная прогулка", sort_order=1)],
    ))
    event.rounds = [first, second]
    db.add(event); db.commit()
