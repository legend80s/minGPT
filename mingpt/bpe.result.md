Original text is:
Hello!! I'm Andrej Karpathy. It's 2022. w00t :D 🤗
First the text gets pre-tokenized, broken up into chunks, the outcome is:
['Hello', '!!', ' I', "'m", ' Andrej', ' Karpathy', '.', ' It', "'s", ' 2022', '.', ' w', '00', 't', ' :', 'D', ' 🤗']
Then we iterate over each chunk and process them in turn...
{'token': 'Hello', 'token_bytes': b'Hello', 'token_translated': 'Hello', 'token_merged': ['Hello'], 'token_ix': [15496]}
{'token': '!!', 'token_bytes': b'!!', 'token_translated': '!!', 'token_merged': ['!!'], 'token_ix': [3228]}
{'token': ' I', 'token_bytes': b' I', 'token_translated': 'ĠI', 'token_merged': ['ĠI'], 'token_ix': [314]}
{'token': "'m", 'token_bytes': b"'m", 'token_translated': "'m", 'token_merged': ["'m"], 'token_ix': [1101]}
{'token': ' Andrej', 'token_bytes': b' Andrej', 'token_translated': 'ĠAndrej', 'token_merged': ['ĠAndre', 'j'], 'token_ix': [10948, 73]}
{'token': ' Karpathy', 'token_bytes': b' Karpathy', 'token_translated': 'ĠKarpathy', 'token_merged': ['ĠK', 'arp', 'athy'], 'token_ix': [509, 5117, 10036]}
{'token': '.', 'token_bytes': b'.', 'token_translated': '.', 'token_merged': ['.'], 'token_ix': [13]}
{'token': ' It', 'token_bytes': b' It', 'token_translated': 'ĠIt', 'token_merged': ['ĠIt'], 'token_ix': [632]}
{'token': "'s", 'token_bytes': b"'s", 'token_translated': "'s", 'token_merged': ["'s"], 'token_ix': [338]}
{'token': ' 2022', 'token_bytes': b' 2022', 'token_translated': 'Ġ2022', 'token_merged': ['Ġ2022'], 'token_ix': [33160]}
{'token': '.', 'token_bytes': b'.', 'token_translated': '.', 'token_merged': ['.'], 'token_ix': [13]}
{'token': ' w', 'token_bytes': b' w', 'token_translated': 'Ġw', 'token_merged': ['Ġw'], 'token_ix': [266]}
{'token': '00', 'token_bytes': b'00', 'token_translated': '00', 'token_merged': ['00'], 'token_ix': [405]}
{'token': 't', 'token_bytes': b't', 'token_translated': 't', 'token_merged': ['t'], 'token_ix': [83]}
{'token': ' :', 'token_bytes': b' :', 'token_translated': 'Ġ:', 'token_merged': ['Ġ:'], 'token_ix': [1058]}
{'token': 'D', 'token_bytes': b'D', 'token_translated': 'D', 'token_merged': ['D'], 'token_ix': [35]}
{'token': ' 🤗', 'token_bytes': b' \xf0\x9f\xa4\x97', 'token_translated': 'ĠðŁ¤Ĺ', 'token_merged': ['ĠðŁ', '¤', 'Ĺ'], 'token_ix': [12520, 97, 245]}
and the final outcome is concatenating and flattening all the token_ix:
[15496, 3228, 314, 1101, 10948, 73, 509, 5117, 10036, 13, 632, 338, 33160, 13, 266, 405, 83, 1058, 35, 12520, 97, 245]
ready to feed into a Transformer!