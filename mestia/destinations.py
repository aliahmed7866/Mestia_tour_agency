"""Local illustrated placeholders and owner-managed destination photographs."""
import re


SCENES = (
    {
        'asset': 'tower-village.svg',
        'title_en': 'Mestia & the Svan towers',
        'title_ka': 'მესტია და სვანური კოშკები',
        'subtitle_en': 'Mountain silhouettes, old stone towers and time to explore at your own pace.',
        'subtitle_ka': 'მთების სილუეტები, ძველი ქვის კოშკები და დრო აღმოჩენებისთვის.',
        'alt_en': 'Illustrated Svan towers below layered mountain peaks in warm evening light',
        'alt_ka': 'სვანური კოშკებისა და მთების ილუსტრაცია საღამოს თბილ შუქში',
    },
    {
        'asset': 'alpine-lake.svg',
        'title_en': 'Lakes & high trails',
        'title_ka': 'ტბები და მთის ბილიკები',
        'subtitle_en': 'Dream up a day above the valley. Ask your guide about routes, conditions and the right season.',
        'subtitle_ka': 'დაგეგმეთ დღე მთაში. ჰკითხეთ გიდს მარშრუტების, პირობებისა და შესაფერისი სეზონის შესახებ.',
        'alt_en': 'Illustrated alpine lake reflecting snow-tipped mountains beneath a pale sky',
        'alt_ka': 'ალპური ტბისა და მასში არეკლილი თოვლიანი მთების ილუსტრაცია',
    },
    {
        'asset': 'mountain-valley.svg',
        'title_en': 'Into the Svaneti valleys',
        'title_ka': 'სვანეთის ხეობებისკენ',
        'subtitle_en': 'Follow the river, take the scenic road and leave room for a quiet moment in the mountains.',
        'subtitle_ka': 'გაჰყევით მდინარეს, დატკბით გზის ხედებით და დაუთმეთ დრო მთის სიმშვიდეს.',
        'alt_en': 'Illustrated winding river through green mountain slopes and a broad Svaneti-inspired valley',
        'alt_ka': 'მთის მწვანე ფერდობებს შორის დაკლაკნილი მდინარისა და ფართო ხეობის ილუსტრაცია',
    },
)


def get_destination_slides(settings):
    slides = []
    for number, scene in enumerate(SCENES, 1):
        slide = dict(scene)
        for field in ('title_en', 'title_ka', 'subtitle_en', 'subtitle_ka'):
            slide[field] = settings.get(f'destination_{field}_{number}', '').strip() or scene[field]
        photo = settings.get(f'destination_image_{number}', '')
        # Photographs must come from our validated upload route, never remote URLs.
        if not re.fullmatch(r'/media/[a-f0-9]{32}\.(jpg|png|webp)', photo):
            photo = ''
        slide['image_path'] = photo or '/static/destinations/' + scene['asset']
        slide['is_placeholder'] = not bool(photo)
        slide['slot'] = number
        if photo:
            slide['alt_en'] = slide['title_en']
            slide['alt_ka'] = slide['title_ka']
        slides.append(slide)
    return slides
