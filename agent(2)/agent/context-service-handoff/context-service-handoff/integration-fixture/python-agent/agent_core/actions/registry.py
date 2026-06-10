from importlib import import_module


def get_all_actions():
    modules = [
        "actions.analyze_requirement",
        "actions.select_skill",
        "actions.make_plan",
        "actions.locate_files",
        "actions.generate_patch",
        "actions.review_patch",
        "actions.execute_patch",
        "actions.verify_result",
        "actions.apply_patch",
        "actions.finish",
    ]
    return [import_module(module).ACTION for module in modules]


def get_action_names():
    return [action["name"] for action in get_all_actions()]


def get_action(name):
    for action in get_all_actions():
        if action["name"] == name:
            return action
    return None
