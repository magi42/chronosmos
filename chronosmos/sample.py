"""Editable illustration inspired by the supplied artwork, not a historical dataset."""


def sample():
    def bar(id, label, start, end, y, bg, **kw):
        return dict(id=id, label=label, start=start, end=end, y=y, height=28,
                    background=bg, foreground='#ffffff', fadeIn=0, fadeOut=0,
                    mergeInto='', mergeYears=100, **kw)

    bars = [
        bar('egypt', 'Egyptian traditions', -1000, 400, 130, '#b79b50'),
        bar('greek', 'Greek traditions', -900, -100, 205, '#7b9475'),
        bar('roman', 'Roman traditions', -500, 350, 280, '#c17a63'),
        bar('christian', 'Christianity', 1, 2026, 355, '#627b9d'),
        bar('mithra', 'Mithraic mysteries', 1, 400, 430, '#af9965'),
        bar('jewish', 'Judaism', -1000, 2026, 505, '#9783ac'),
        bar('zoro', 'Zoroastrianism', -700, 2026, 580, '#749b98'),
        bar('islam', 'Islam', 610, 2026, 655, '#568e7a'),
    ]
    bars[0]['fadeOut'] = 250
    bars[1].update(mergeInto='roman', mergeYears=200)
    bars[2].update(mergeInto='christian', mergeYears=250)
    bars[4].update(fadeIn=100, fadeOut=150)
    bars[5]['fadeIn'] = 200
    bars[6]['fadeIn'] = 200
    return dict(version=1, title='A tapestry of traditions', slug='traditions',
                description='An editable composition inspired by the supplied Finnish timeline. Dates and connections are illustrative, not a verified historical account.',
                start=-1000, end=2026, mmPerYear=.35, height=820,
                scale='both', background='#faf8f2', bars=bars,
                overlays=[dict(id='note1', type='text', year=610, y=696, width=250,
                               height=60, text='A new chapter\n7th century CE', color='#53665a',
                               fill='#faf8f2', fontSize=13),
                          dict(id='note2', type='box', year=-920, y=660, width=225,
                               height=85, text='Ideas travel.\nTraditions meet and change.', color='#625c4f',
                               fill='#eee9dc', fontSize=14)],
                events=[dict(id='event1', year=1, label='1 CE', y=82, height=660,
                             width=1, color='#c9c1b0', layer='under'),
                        dict(id='event2', year=1517, label='1517 · Reformation', y=95,
                             height=630, width=1, color='#c9c1b0', layer='under')])
