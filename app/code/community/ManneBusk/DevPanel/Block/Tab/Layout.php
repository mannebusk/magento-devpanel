<?php
/**
 *
 * @package ManneBusk_DevPanel
 * @module  ManneBusk
 * @author  ManneBusk <mannebusk@gmail.com>
 */
class ManneBusk_DevPanel_Block_Tab_Layout
    extends ManneBusk_DevPanel_Block_Tab
{
    /**
     * Get info about all blocks
     *
     * @return Core_Model_Mysql4_Website_Collection
     */
    public function getBlockInfo()
    {
        $blocks = $this->getLayout()->getAllBlocks();
        $result = array();

        foreach ($blocks as $block) {
            $info = array(
                'name'          => $block->getNameInLayout(),
                'class'         => get_class($block),
                'alias'         => $block->getBlockAlias(),
            );

            if ($block instanceof Mage_Core_Block_Template) {
                $info['template'] = $block->getTemplate();
            }

            $result[] = new Varien_Object($info);
        }

        return $result;
    }
}
